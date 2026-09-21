import { cloneAt } from "./cloneAt.js";
import { removeAll } from "./removeAll.js";
import type { WorkflowSource } from "../types.js";
import type { ProvidedTree, RunCommand, TreeSource } from "./types.js";

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
): TreeSource {
  const remoteUrl =
    opts.remoteUrl ?? ((s: WorkflowSource) => `https://github.com/${s.owner}/${s.repo}.git`);
  const cache = new Map<string, Promise<ProvidedTree | null>>();
  return {
    provide: async (source) => {
      const key = `${source.owner}/${source.repo}@${source.sha}`;
      let p = cache.get(key);
      if (p === undefined) {
        p = cloneAt(source, remoteUrl(source), token, runCommand);
        cache.set(key, p);
      }
      return (await p)?.tree ?? null;
    },
    remove: () => removeAll(cache.values()),
  };
}
