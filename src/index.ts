import fs from "node:fs";
import path from "node:path";
import * as githubCore from "@actions/core";
import * as github from "@actions/github";
import AdmZip from "adm-zip";
import FormData from "form-data";
import YAML from "yaml";
import apiClient from "./utils/api-client";

interface CommonManifest {
  requires: string;
  version: string;
}

interface AppRelease {
  apiVersion: string;
  kind: string;
  metadata: {
    annotations?: Record<string, string>;
    finalizers?: string[] | null;
    generateName?: string;
    labels?: Record<string, string>;
    name: string;
    version?: number | null;
  };
  spec?: {
    applicationName: string;
    displayName: string;
    draft: boolean;
    ownerName?: string;
    preRelease: boolean;
    requires: string;
    version: string;
    notesName?: string;
  };
  status?: {
    published?: boolean;
    publishTimestamp?: string | null;
  } | null;
}

interface AppReleaseRequest {
  release: AppRelease;
  notes: {
    apiVersion: string;
    html: string;
    kind: string;
    metadata: {
      generateName?: string;
      name: string;
    };
    rawType: "MARKDOWN";
    raw: string;
  };
  makeLatest: boolean;
}

const token = githubCore.getInput("github-token");
const octokit = github.getOctokit(token);
const appId = githubCore.getInput("app-id");
const assetsDir = githubCore.getInput("assets-dir");
const releaseId = githubCore.getInput("release-id");
const publishMaxAttempts = 5;

const run = async () => {
  if (!releaseId) {
    throw new Error("Release ID not found");
  }

  const {
    repo: { owner, repo },
  } = github.context;

  const repoInfo = await getGitHubRepoInfo(owner, repo);
  const releaseInfo = await getGitHubReleaseInfo(owner, repo);

  const { html, markdown } = await getReleaseNote(repoInfo, releaseInfo);

  const assets = getAssets();

  const appManifest = readAppManifest(assets);

  const appRelease = await createAppRelease(
    releaseInfo,
    html,
    markdown,
    appManifest,
  );

  await uploadAssets(appRelease.metadata.name, assets);

  await publishAppRelease(appRelease, html, markdown);
};

run()
  .then(() => {
    githubCore.info("✅ [Completed]: App release created successfully");
  })
  .catch((error) => {
    githubCore.setFailed(`❌ [Failed]: ${error.message}`);
  });

async function getGitHubReleaseInfo(owner: string, repo: string) {
  githubCore.info("Fetch GitHub release info");

  const release = await octokit.rest.repos.getRelease({
    owner,
    repo,
    release_id: Number(releaseId),
  });

  githubCore.info("Successfully fetched release info");

  return release;
}

async function getGitHubRepoInfo(owner: string, repo: string) {
  githubCore.info("Fetch GitHub repo info");

  const repoInfo = await octokit.rest.repos.get({ owner, repo });

  githubCore.info("Successfully fetched repo info");

  return repoInfo;
}

async function getReleaseNote(
  repoInfo: Awaited<ReturnType<typeof getGitHubRepoInfo>>,
  releaseInfo: Awaited<ReturnType<typeof getGitHubReleaseInfo>>,
): Promise<{ html: string; markdown: string }> {
  const {
    repo: { owner, repo },
  } = github.context;

  let releaseBody = `${releaseInfo.data.body || ""}`;

  if (releaseBody && !repoInfo.data.private) {
    releaseBody += "\n\n---";
  }

  if (!repoInfo.data.private) {
    releaseBody += `\n\n*Generated from [${releaseInfo.data.tag_name}](${releaseInfo.data.html_url})*`;
  }

  const html = await octokit.rest.markdown.render({
    text: releaseBody,
    mode: "gfm",
    context: `${owner}/${repo}`,
  });

  return { html: html.data, markdown: releaseBody };
}

function readAppManifest(assets: string[]): CommonManifest | undefined {
  githubCore.info("Read app manifest");

  const jarFile = assets.find((file) => file.endsWith(".jar"));
  const zipFile = assets.find((file) => file.endsWith(".zip"));

  let targetFile: string | null = null;
  let isPlugin = false;

  if (jarFile) {
    targetFile = path.join(assetsDir, jarFile);
    isPlugin = true;
    githubCore.info(`Found plugin file: ${jarFile}`);
  } else if (zipFile) {
    targetFile = path.join(assetsDir, zipFile);
    isPlugin = false;
    githubCore.info(`Found theme file: ${zipFile}`);
  } else {
    throw new Error("No jar or zip file found in assets directory");
  }

  try {
    const zip = new AdmZip(targetFile);

    const yamlFileName = isPlugin ? "plugin.yaml" : "theme.yaml";
    const yamlEntry = zip.getEntry(yamlFileName);

    if (!yamlEntry) {
      throw new Error(
        `${
          isPlugin ? "Plugin" : "Theme"
        } package does not contain ${yamlFileName} file`,
      );
    }

    const yamlContent = yamlEntry.getData().toString("utf8");
    const manifest = YAML.parse(yamlContent);

    githubCore.info("Successfully read app manifest");
    return {
      requires: manifest.spec.requires,
      version: manifest.spec.version,
    };
  } catch (error) {
    throw new Error(`Failed to read manifest file: ${error?.toString()}`);
  }
}

async function createAppRelease(
  release: Awaited<ReturnType<typeof getGitHubReleaseInfo>>,
  html: string,
  markdown: string,
  appManifest?: CommonManifest,
) {
  githubCore.info("Create draft app release");

  if (!appManifest) {
    throw new Error("App manifest not found");
  }

  const releaseRequest: AppReleaseRequest = {
    release: {
      apiVersion: "store.halo.run/v1alpha1",
      kind: "Release",
      metadata: {
        generateName: "app-release-",
        name: "",
      },
      spec: {
        applicationName: "",
        displayName: release.data.name || release.data.tag_name,
        draft: true,
        ownerName: "",
        preRelease: release.data.prerelease,
        requires: appManifest.requires,
        version: appManifest.version,
        notesName: "",
      },
    },
    notes: {
      apiVersion: "store.halo.run/v1alpha1",
      html,
      kind: "Content",
      metadata: {
        generateName: "app-release-notes-",
        name: "",
      },
      rawType: "MARKDOWN",
      raw: markdown,
    },
    makeLatest: true,
  };

  const { data: appRelease } = await apiClient.post<AppRelease>(
    `/apis/uc.api.developer.store.halo.run/v1alpha1/releases?${new URLSearchParams(
      { applicationName: appId },
    ).toString()}`,
    releaseRequest,
  );

  if (!appRelease.metadata.name) {
    throw new Error("Created app release name not found");
  }

  githubCore.info("Successfully created draft app release");
  return appRelease;
}

async function publishAppRelease(
  appRelease: AppRelease,
  html: string,
  markdown: string,
) {
  githubCore.info("Publish app release");

  let releaseToPublish = appRelease;

  for (let attempt = 1; attempt <= publishMaxAttempts; attempt++) {
    try {
      await putPublishedAppRelease(releaseToPublish, html, markdown);
      githubCore.info("Successfully published app release");
      return;
    } catch (error) {
      if (!isConflictError(error) || attempt === publishMaxAttempts) {
        throw error;
      }

      const delayMs = 1000 * attempt;
      githubCore.warning(
        `Publish app release conflicted, retrying in ${delayMs}ms (${attempt}/${publishMaxAttempts})`,
      );
      await delay(delayMs);
      releaseToPublish = await getAppRelease(appRelease.metadata.name);
    }
  }
}

async function putPublishedAppRelease(
  appRelease: AppRelease,
  html: string,
  markdown: string,
) {
  if (!appRelease.spec?.notesName) {
    throw new Error("App release notes name not found");
  }
  const releaseRequest: AppReleaseRequest = {
    release: {
      ...appRelease,
      spec: {
        ...appRelease.spec,
        draft: false,
      },
    },
    notes: {
      apiVersion: "store.halo.run/v1alpha1",
      html,
      kind: "Content",
      metadata: {
        name: appRelease.spec.notesName,
      },
      rawType: "MARKDOWN",
      raw: markdown,
    },
    makeLatest: true,
  };

  await apiClient.put(
    `/apis/uc.api.developer.store.halo.run/v1alpha1/releases/${encodeURIComponent(
      appRelease.metadata.name,
    )}`,
    releaseRequest,
  );
}

async function getAppRelease(releaseName: string) {
  const { data: appRelease } = await apiClient.get<AppRelease>(
    `/apis/uc.api.developer.store.halo.run/v1alpha1/releases/${encodeURIComponent(
      releaseName,
    )}`,
  );

  return appRelease;
}

function isConflictError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: number } }).response?.status === 409
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAssets() {
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets directory does not exist: ${assetsDir}`);
  }

  const assets = fs.readdirSync(assetsDir);
  if (assets.length === 0) {
    throw new Error(`Assets directory is empty: ${assetsDir}`);
  }

  return assets;
}

async function uploadAssets(releaseName: string, assets: string[]) {
  githubCore.info(`Uploading ${assets.length} assets`);

  const uploadPromises = assets.map(async (asset, index) => {
    const assetPath = `${assetsDir}/${asset}`;

    if (!fs.existsSync(assetPath)) {
      throw new Error(`Asset file does not exist: ${assetPath}`);
    }

    githubCore.info(`Uploading file (${index + 1}/${assets.length}): ${asset}`);

    const formData = new FormData();
    formData.append("releaseName", releaseName);
    formData.append("file", fs.createReadStream(assetPath), asset);

    await apiClient.post(
      "/apis/uc.api.developer.store.halo.run/v1alpha1/assets",
      formData,
      {
        headers: formData.getHeaders(),
      },
    );

    githubCore.info(`Successfully uploaded file: ${asset}`);
  });

  await Promise.all(uploadPromises);
  githubCore.info("All assets uploaded");
}
