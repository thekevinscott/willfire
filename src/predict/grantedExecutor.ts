import type { Octokit } from "@octokit/rest";
import { makeExecutor } from "../execute/makeExecutor.js";
import { makeTreeProvider } from "../execute/makeTreeProvider.js";
import { runShell } from "../execute/runShell.js";
import type { ExecutionGrant, JobExecutor } from "../execute/types.js";
import type { ResolveRef, WorkflowSource } from "../types.js";

export function grantedExecutor(
  octokit: Octokit,
  workspace: WorkflowSource,
  resolveRef: ResolveRef,
  grants: ExecutionGrant[] | undefined,
): JobExecutor | undefined {
  if (grants == null || grants.length === 0) {
    return undefined;
  }
  const download = async (src: WorkflowSource): Promise<Uint8Array | null> => {
    try {
      const { data } = await octokit.rest.repos.downloadTarballArchive({
        owner: src.owner,
        repo: src.repo,
        ref: src.sha,
      });
      return new Uint8Array(data as ArrayBuffer);
    } catch {
      return null;
    }
  };
  return makeExecutor({
    grants,
    workspace,
    deps: {
      provideTree: makeTreeProvider(download, runShell),
      runCommand: runShell,
      resolveRef,
    },
  });
}
