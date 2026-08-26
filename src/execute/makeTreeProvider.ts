import type { WorkflowSource } from "../types.js";
import { materialize } from "./materialize.js";
import type { ProvideTree, RunCommand } from "./types.js";

/**
 * Materialize repo trees from tarballs, one download per commit. GitHub wraps
 * the tree in a single `owner-repo-shortsha/` directory, unwrapped here.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): ProvideTree {
  const cache = new Map<string, Promise<string | null>>();
  return (source, opts) => {
    // A tarball has no history to give.
    if (opts?.history === true) {
      return Promise.resolve(null);
    }
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const p = materialize(source, download, runCommand);
    cache.set(key, p);
    return p;
  };
}
