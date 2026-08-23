import { Octokit } from "@octokit/rest";

export function makeOctokit(): Octokit {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN must be set");
  return new Octokit({ auth: token });
}
