import type { Octokit } from "@octokit/rest";
import { sourceKey } from "./sourceKey.js";
import type {
  FetchWorkflow,
  ResolveRef,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

/**
 * The reader one prediction shares across every expansion: both lookups are
 * cached for its lifetime, and every ref that resolves is recorded into
 * `sources` as provenance for the answer.
 */
export function makeReader(
  octokit: Octokit,
  sources: Map<string, WorkflowSource>,
): WorkflowReader {
  // A `uses:` naming a tag is the same lookup from every caller that writes it,
  // so resolve each `owner/repo@ref` once. Misses are cached too: a ref that
  // cannot be resolved will not start resolving on the second ask.
  const refCache = new Map<string, string | null>();
  const resolveRef: ResolveRef = async (src) => {
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
      // Deleted tag, private repo, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      sha = null;
    }
    refCache.set(key, sha);
    if (sha != null) {
      sources.set(key, { ...src, sha });
    }
    return sha;
  };

  // One callee is commonly reached from several callers — a fleet repo calls
  // the same `testing-conventions@v0` from eight workflows — so remember what
  // each `owner/repo/path@sha` resolved to, misses included.
  const cache = new Map<string, string | null>();
  const fetchWorkflow: FetchWorkflow = async (path, src) => {
    // Keyed and fetched on the commit, never the ref that named it. Two callers
    // writing `@v0` and `@abc123` for the same commit are one read, and a tag
    // that moves mid-prediction cannot hand back two different files.
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
      // Private, deleted, bad ref, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      content = null;
    }
    cache.set(key, content);
    return content;
  };

  return { fetchWorkflow, resolveRef };
}
