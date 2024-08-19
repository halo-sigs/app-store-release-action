import * as githubCore from "@actions/core";
import * as github from "@actions/github";
import fs from "fs";
import YAML from "yaml";
import apiClient from "./utils/api-client";

const PLUGIN_MANIFEST_PATH = "src/main/resources/plugin.yaml";
const THEME_MANIFEST_PATH = "theme.yaml";

const token = githubCore.getInput("github-token");
const octokit = github.getOctokit(token);
const appId = githubCore.getInput("app-id");
const assetsDir = githubCore.getInput("assets-dir");
const releaseId = githubCore.getInput("release-id");

const run = async () => {
  if (!releaseId) {
    githubCore.error("Release ID not found");
    return;
  }

  const {
    repo: { owner, repo },
  } = github.context;

  githubCore.info("Getting release information");

  const release = await octokit.rest.repos.getRelease({
    owner,
    repo,
    release_id: Number(releaseId),
  });

  githubCore.info("Release information retrieved");

  const releaseBody = `
${release.data.body || ""}


${release.data.body ? "---" : ""}


*Generated from [${release.data.tag_name}](${release.data.html_url})*
`;

  githubCore.info("Rendering markdown");

  const markdown = await octokit.rest.markdown.render({
    text: releaseBody,
    mode: "gfm",
    context: `${owner}/${repo}`,
  });

  githubCore.info("Markdown rendering completed");

  githubCore.info("Reading app manifest file");

  let appManifestFile;

  if (fs.existsSync(PLUGIN_MANIFEST_PATH)) {
    appManifestFile = fs.readFileSync(PLUGIN_MANIFEST_PATH, { encoding: "utf-8" });
  } else if (fs.existsSync(THEME_MANIFEST_PATH)) {
    appManifestFile = fs.readFileSync(THEME_MANIFEST_PATH, { encoding: "utf-8" });
  } else {
    throw new Error("No manifest file found");
  }

  githubCore.info("App manifest file read successfully");

  const appManifest = YAML.parse(appManifestFile.toString());

  githubCore.info("Creating a release");

  const { data: appRelease } = await apiClient.post(
    `/apis/uc.api.developer.store.halo.run/v1alpha1/releases?applicationName=${appId}`,
    {
      release: {
        apiVersion: "store.halo.run/v1alpha1",
        kind: "Release",
        metadata: {
          generateName: "app-release-",
          name: "",
        },
        spec: {
          applicationName: "",
          displayName: release.data.name,
          draft: false,
          ownerName: "",
          preRelease: release.data.prerelease,
          requires: appManifest.spec.requires,
          version: release.data.tag_name.replace("v", ""),
          notesName: "",
        },
      },
      notes: {
        apiVersion: "store.halo.run/v1alpha1",
        html: markdown.data,
        kind: "Content",
        metadata: {
          generateName: "app-release-notes-",
          name: "",
        },
        rawType: "MARKDOWN",
        raw: releaseBody,
      },
      makeLatest: true,
    }
  );

  githubCore.info("Release created successfully");

  const assets = fs.readdirSync(assetsDir);

  assets.forEach(async (asset) => {
    const formData = new FormData();

    formData.append("releaseName", appRelease.metadata.name);
    formData.append("file", fs.readFileSync(`${assetsDir}/${asset}`) as any);

    await apiClient.post(`/apis/uc.api.developer.store.halo.run/v1alpha1/assets`, formData);
  });
};

run()
  .then(() => {
    githubCore.info(`✅ [DONE]: Release created successfully`);
  })
  .catch((error) => {
    githubCore.setFailed(error.message);
  });
