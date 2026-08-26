import type { WorkflowSource } from "../types.js";
import { cloneAt } from "./cloneAt.js";
import type { ProvideTree, RunCommand } from "./types.js";

/**
 * Materialize repo trees by full clone, on the host — it needs the network
 * the sandbox denies. The token never touches the URL or persisted git
 * config, because `.git/config` later rides into the sandbox: auth travels
 * as a per-invocation `http.extraheader` and is gone when the command is.
 */
export function makeCloneProvider(
  runCommand: RunCommand,
  token: string | null,
  opts: { remoteUrl?: (source: WorkflowSource) => string } = {},
): ProvideTree {
  const remoteUrl =
    opts.remoteUrl ?? ((s: WorkflowSource) => `https://github.com/${s.owner}/${s.repo}.git`);
  const cache = new Map<string, Promise<string | null>>();
  return (source) => {
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const p = cloneAt(source, remoteUrl(source), token, runCommand);
    cache.set(key, p);
    return p;
  };
}
