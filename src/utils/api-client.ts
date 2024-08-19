import axios from "axios";
import * as githubCore from "@actions/core";

const baseURL = githubCore.getInput("halo-backend-baseurl");
const pat = githubCore.getInput("halo-pat");

const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    Authorization: `Bearer ${pat}`,
  },
});

export default apiClient;
