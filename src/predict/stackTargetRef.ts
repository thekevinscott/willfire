import type { Octokit } from "@octokit/rest";
import type { StackNode } from "../types.js";

const MAX_STACK_DEPTH = 10;

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
      if (mergeSha == null) {
        break;
      }
      const { data: preview } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: mergeSha,
      });
      const previewParent = preview.parents[0]?.sha;
      if (previewParent == null) {
        break;
      }
      const { data: baseTip } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: cur.base.ref,
      });
      if (previewParent === baseTip.sha) {
        break;
      }
      const { data: candidates } = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${cur.base.ref}`,
        per_page: 100,
      });
      const parent = candidates.find((p) => p.merge_commit_sha === previewParent);
      if (parent == null) {
        break;
      }
      target = parent.base.ref;
      cur = parent;
    }
  } catch {
  }
  return target;
}
