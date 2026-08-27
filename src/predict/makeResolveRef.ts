import type { Octokit } from "@octokit/rest";
import { sourceKey } from "./sourceKey.js";
import type { ResolveRef, WorkflowSource } from "../types.js";

export function makeResolveRef(
  octokit: Octokit,
  sources: Map<string, WorkflowSource>,
): ResolveRef {
  const refCache = new Map<string, string | null>();
  return async (src) => {
    const key = sourceKey(src);
    const hit = refCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let sha: string | null;
    try {
      const { data } = await octokit.rest.repos.getCommit({
        owner: src.owner,
        repo: src.repo,
        ref: src.ref,
      });
      sha = data.sha;
    } catch {
      sha = null;
    }
    refCache.set(key, sha);
    if (sha != null) {
      sources.set(key, { ...src, sha });
    }
    return sha;
  };
}
