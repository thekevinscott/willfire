import { materialize } from "./materialize.js";
import { removeAll } from "./removeAll.js";
import type { WorkflowSource } from "../types.js";
import type { ProvidedTree, RunCommand, TreeSource } from "./types.js";

/**
 * Materialize repo trees from tarballs, one download per commit. GitHub wraps
 * the tree in a single `owner-repo-shortsha/` directory, unwrapped here.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): TreeSource {
  const cache = new Map<string, Promise<ProvidedTree | null>>();
  return {
    provide: async (source, opts) => {
      // A tarball has no history to give.
      if (opts?.history === true) {
        return null;
      }
      const key = `${source.owner}/${source.repo}@${source.sha}`;
      let p = cache.get(key);
      if (p === undefined) {
        p = materialize(source, download, runCommand);
        cache.set(key, p);
      }
      return (await p)?.tree ?? null;
    },
    remove: () => removeAll(cache.values()),
  };
}
