import type { GithubClient, ResolveRef } from "willfire";

/**
 * Ref resolution for the executor the recorder wraps around `predict`. Deleted
 * tag, private repo, rate limit, network: all one answer, matching what
 * `predict` does with its own resolver rather than throwing.
 */
export function makeResolveRef(github: GithubClient): ResolveRef {
  return async (src) => {
    try {
      const { data } = await github.rest.repos.getCommit({
        owner: src.owner,
        repo: src.repo,
        ref: src.ref,
      });
      return data.sha;
    } catch {
      return null;
    }
  };
}
