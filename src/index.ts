import apiClient from "./utils/api-client";
import fs from "fs/promises";
import * as github from "@actions/github";
import * as githubCore from "@actions/core";
import YAML from "yaml";
import { toFormData } from "axios";

const token = githubCore.getInput("github-token");
const octokit = github.getOctokit(token);
const appId = githubCore.getInput("app-id");
const assetsDir = githubCore.getInput("assets-dir");
const releaseId = githubCore.getInput("release-id");

const run = async () => {
  const { data: app } = await apiClient.get(`/apis/uc.api.developer.store.halo.run/v1alpha1/applications/${appId}`);

  if (!app) {
    githubCore.error("App not found");
    return;
  }

  if (!releaseId) {
    githubCore.error("Release id not found");
    return;
  }

  const {
    repo: { owner, repo },
  } = github.context;

  githubCore.info("Getting release info");

  const release = await octokit.rest.repos.getRelease({
    owner,
    repo,
    release_id: Number(releaseId),
  });

  githubCore.info("Getting release info done");

  let releaseBody = `
${release.data.body || ""}`;

  if (!app.spec.openSource.closed) {
    releaseBody += `
  
${release.data.body ? "---" : ""}
  
*Generate from [${release.data.tag_name}](${release.data.html_url})*`;
  }

  githubCore.info("Rendering markdown");

  const markdown = await octokit.rest.markdown.render({
    text: releaseBody,
    mode: "gfm",
    context: `${owner}/${repo}`,
  });

  githubCore.info("Rendering markdown done");

  githubCore.info("Reading app manifest file");

  const appManifestFile = await fs.readFile(
    app.spec.type === "PLUGIN" ? `src/main/resources/plugin.yaml` : `theme.yaml`,
    { encoding: "utf-8" }
  );

  githubCore.info("Reading app manifest file done");

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

  githubCore.info("Creating a release done");

  const assets = await fs.readdir(assetsDir);

  assets.forEach(async (asset) => {
    const formData = toFormData({
      releaseName: appRelease.metadata.name,
      file: await fs.readFile(`${assetsDir}/${asset}`),
    });

    await apiClient
      .post(`/apis/uc.api.developer.store.halo.run/v1alpha1/assets`, formData, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      })
      .catch((error) => {
        githubCore.error("❌ [ERROR]: Upload asset failed", error);
      });
  });
};

run()
  .then(() => {
    githubCore.info(`✅ [DONE]: Release created`);
  })
  .catch((error) => {
    githubCore.setFailed(error.message);
  });
