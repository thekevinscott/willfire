import type { Octokit } from "@octokit/rest";
import {
  makeCloneProvider,
  makeExecutor,
  makeTreeProvider,
  runShell,
  type JobExecutor,
  type ProvideTree,
  type RunCommand,
} from "../execute.js";
import { makeSandboxRunner, SANDBOX_NODE_MAJOR } from "../sandbox.js";
import type { ResolveRef, WorkflowSource } from "../types.js";

export interface LiveExecutorOpts {
  /** How steps run; the hermetic docker sandbox by default. */
  runCommand?: RunCommand;
  /**
   * Auth for history clones. `undefined` reads `GH_TOKEN` / `GITHUB_TOKEN`
   * from the environment; `null` clones anonymously.
   */
  token?: string | null;
  /** Where clones come from — a seam for tests that serve `file://` fixtures. */
  remoteUrl?: (source: WorkflowSource) => string;
}

/**
 * The executor `predict` uses by default: trees from the tarball endpoint at
 * the resolved commit — or a full clone when a job's checkout wants history —
 * and every repo-authored step run inside the docker sandbox. The sandbox
 * provisions lazily, so building this executor costs nothing until a job
 * actually executes.
 *
 * Infrastructure subprocesses — `tar`, `git` — run on the host through
 * `runShell`: they are willfire's own commands over data, not repo code, and
 * the clone needs the network the sandbox denies.
 */
export function makeLiveExecutor(
  octokit: Octokit,
  workspace: WorkflowSource,
  resolveRef: ResolveRef,
  opts: LiveExecutorOpts = {},
): JobExecutor {
  const download = async (src: WorkflowSource): Promise<Uint8Array | null> => {
    try {
      const { data } = await octokit.rest.repos.downloadTarballArchive({
        owner: src.owner,
        repo: src.repo,
        ref: src.sha,
      });
      return new Uint8Array(data as ArrayBuffer);
    } catch {
      // Private, deleted, rate limit, network: one answer, and the entries
      // behind it stay unresolved with the failure named.
      return null;
    }
  };
  const token =
    opts.token !== undefined
      ? opts.token
      : (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null);
  const tarballs = makeTreeProvider(download, runShell);
  const clones = makeCloneProvider(
    runShell,
    token,
    opts.remoteUrl == null ? {} : { remoteUrl: opts.remoteUrl },
  );
  const provideTree: ProvideTree = (src, o) =>
    o?.history === true ? clones(src, o) : tarballs(src, o);
  return makeExecutor({
    workspace,
    deps: {
      provideTree,
      runCommand: opts.runCommand ?? makeSandboxRunner(),
      resolveRef,
      nodeMajor: SANDBOX_NODE_MAJOR,
    },
  });
}
