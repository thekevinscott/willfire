import { cachedByKey } from "./cachedByKey.js";
import { materialize } from "./materialize.js";
import type { WorkflowSource } from "../types.js";
import type { RunCommand, TreeSource } from "./types.js";

/**
 * Materialize repo trees from tarballs, one download per commit. GitHub wraps
 * the tree in a single `owner-repo-shortsha/` directory, unwrapped here.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): TreeSource {
  const cached = cachedByKey((source) => materialize(source, download, runCommand));
  return {
    provide: async (source, opts) => {
      // A tarball has no history to give.
      if (opts?.history === true) {
        return null;
      }
      return await cached.provide(source);
    },
    remove: cached.remove,
  };
}
