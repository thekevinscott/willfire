import type { Octokit } from "@octokit/rest";
import type { FetchWorkflow } from "../types.js";

export function makeFetchWorkflow(octokit: Octokit): FetchWorkflow {
  const cache = new Map<string, string | null>();
  return async (path, src) => {
    const key = `${src.owner}/${src.repo}/${path}@${src.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let content: string | null;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: src.owner,
        repo: src.repo,
        path,
        ref: src.sha,
        mediaType: { format: "raw" },
      });
      content = data as unknown as string;
    } catch {
      content = null;
    }
    cache.set(key, content);
    return content;
  };
}
