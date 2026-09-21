import { makeCloneProvider } from "../execute/makeCloneProvider.js";
import { makeExecutor } from "../execute/makeExecutor.js";
import { makeTreeProvider } from "../execute/makeTreeProvider.js";
import { runShell } from "../execute/runShell.js";
import type { JobExecutor, ProvideTree, RunCommand } from "../execute/types.js";
import type { GithubClient } from "./makeGithubClient.js";
import { makeSandboxRunner } from "../sandbox/makeSandboxRunner.js";
import { SANDBOX_NODE_MAJOR } from "../sandbox/sandboxConfig.js";
import type { ResolveRef, WorkflowSource } from "../types.js";

export interface LiveExecutorOpts {
  /** How steps and tarball extraction run; the hermetic docker sandbox by default. */
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
 * The executor `predict` uses by default. Repo-authored steps and the `tar`
 * that unpacks a downloaded repo both run in the docker sandbox; `git clone`
 * still runs on the host, since it needs the network the sandbox denies.
 */
export function makeLiveExecutor(
  github: Pick<GithubClient, "downloadTarball">,
  workspace: WorkflowSource,
  resolveRef: ResolveRef,
  opts: LiveExecutorOpts = {},
): JobExecutor {
  const download = async (src: WorkflowSource): Promise<Uint8Array | null> => {
    try {
      const tarball = await github.downloadTarball({
        owner: src.owner,
        repo: src.repo,
        ref: src.sha,
      });
      return new Uint8Array(tarball);
    } catch {
      // Private, deleted, rate limit, network: one answer.
      return null;
    }
  };
  const token =
    opts.token !== undefined
      ? opts.token
      : (process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null);
  // One runner, so the image is provisioned once and extraction gets the same
  // isolation as the steps.
  const runCommand = opts.runCommand ?? makeSandboxRunner();
  const tarballs = makeTreeProvider(download, runCommand);
  const clones = makeCloneProvider(
    runShell,
    token,
    opts.remoteUrl === undefined ? {} : { remoteUrl: opts.remoteUrl },
  );
  const provideTree: ProvideTree = (src, o = {}) =>
    o.history === true ? clones.provide(src, o) : tarballs.provide(src, o);
  const executor = makeExecutor({
    workspace,
    deps: {
      provideTree,
      runCommand,
      resolveRef,
      nodeMajor: SANDBOX_NODE_MAJOR,
    },
  });
  return {
    ...executor,
    cleanup: async () => {
      await tarballs.remove();
      await clones.remove();
    },
  };
}
