import axios from "axios";
import * as githubCore from "@actions/core";

const username = githubCore.getInput("halo-username");
const password = githubCore.getInput("halo-password");
const baseURL = githubCore.getInput("halo-backend-baseurl");

const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  auth: {
    username: username,
    password: password,
  },
});

export default apiClient;
