import type { Octokit } from "@octokit/rest";
import type { StackNode } from "../types.js";

/** Past this the walk stops at the last proven hop, which only narrows reach. */
const MAX_STACK_DEPTH = 10;

/**
 * The branch this PR's stack ultimately targets, or null for a plain PR.
 *
 * GitHub's stacked-PR machinery (server-side, per-repo rollout — engaged on
 * dirsql, not on willrun-probe, so it cannot be inferred from PR structure)
 * builds a child PR's test merge on the parent PR's test merge and evaluates
 * `branches:` against the stack's terminal target (#30). The mode is read off
 * `merge_commit_sha`: its first parent is the base tip in normal mode and the
 * parent PR's own merge sha in stacked mode. Anything undecidable ends the
 * walk at the last proven hop; never throws.
 */
export async function stackTargetRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: StackNode,
): Promise<string | null> {
  let target: string | null = null;
  let cur = pr;
  try {
    for (let hop = 0; hop < MAX_STACK_DEPTH; hop++) {
      const mergeSha = cur.merge_commit_sha;
      if (mergeSha === null) {
        break;
      }
      const { data: preview } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: mergeSha,
      });
      const previewParent = preview.parents[0]?.sha;
      if (previewParent === undefined) {
        break;
      }
      const { data: baseTip } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: cur.base.ref,
      });
      // Built on the base branch tip: normal mode, the walk is done.
      if (previewParent === baseTip.sha) {
        break;
      }
      // Otherwise only an exact match against an open PR whose head is the
      // base branch proves stacked mode; a stale preview matches nothing.
      const { data: candidates } = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${cur.base.ref}`,
        per_page: 100,
      });
      const parent = candidates.find((p) => p.merge_commit_sha === previewParent);
      if (parent === undefined) {
        break;
      }
      target = parent.base.ref;
      cur = parent;
    }
  } catch {
    // Rate limit, permissions, network: stop at the last proven hop.
  }
  return target;
}
