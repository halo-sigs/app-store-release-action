import axios from "axios";
import * as githubCore from "@actions/core";

const username = githubCore.getInput("halo-username");
const password = githubCore.getInput("halo-password");

const apiClient = axios.create({
  baseURL: "https://halo.run",
  withCredentials: true,
  auth: {
    username: username,
    password: password,
  },
});

export default apiClient;
