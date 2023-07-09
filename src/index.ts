import apiClient from "./utils/api-client";
import fs from "fs/promises";
import * as github from "@actions/github";
import * as githubCore from "@actions/core";
import YAML from "yaml";

const token = githubCore.getInput("github-token");
const octokit = github.getOctokit(token);
const appId = githubCore.getInput("app-id");
const assetsDir = githubCore.getInput("assets-dir");
const releaseId = githubCore.getInput("release-id");

const run = async () => {
  const { data: app } = await apiClient.get(`/apis/api.console.halo.run/v1alpha1/applications/${appId}`);

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

  const release = await octokit.rest.repos.getRelease({
    owner,
    repo,
    release_id: Number(releaseId),
  });

  const markdown = await octokit.rest.markdown.render({
    text: release.data.body || "",
    mode: "gfm",
    context: `${owner}/${repo}`,
  });

  const appConfigFile = await fs.readFile(
    app.spec.type === "PLUGIN" ? `src/main/resources/plugin.yaml` : `theme.yaml`,
    { encoding: "utf-8" }
  );

  const appConfig = YAML.parse(appConfigFile.toString());

  const { data: appRelease } = await apiClient.post(
    `/apis/api.console.halo.run/v1alpha1/applications/${app.metadata.name}/releases`,
    {
      release: {
        apiVersion: "store.halo.run/v1alpha1",
        kind: "Release",
        metadata: {
          generateName: "app-release-",
          name: "",
        },
        spec: {
          displayName: release.data.name,
          draft: false,
          ownerName: "",
          preRelease: false,
          requires: appConfig.spec.requires,
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
        raw: release.data.body,
      },
      makeLatest: true,
    }
  );

  const assets = await fs.readdir(assetsDir);

  assets.forEach(async (asset) => {
    await apiClient
      .post(
        `/apis/api.console.halo.run/v1alpha1/applications/${app.metadata.name}/releases/${appRelease.metadata.name}/upload-asset?filename=${asset}`,
        await fs.readFile(`${assetsDir}/${asset}`),
        {
          headers: {
            "Content-Type": "application/octet-stream",
          },
        }
      )
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
    githubCore.error("❌ [ERROR]: Release to Halo app store failed", error);
    process.exit(1);
  });
