import { removeAll } from "./removeAll.js";
import type { WorkflowSource } from "../types.js";
import type { ProvidedTree, TreeSource } from "./types.js";

/**
 * One materialization per commit, shared across every job that asks for it.
 * The in-flight promise is what is cached, so concurrent askers for the same
 * commit wait on one load rather than racing two.
 */
export function cachedByKey(
  load: (source: WorkflowSource) => Promise<ProvidedTree | null>,
): TreeSource {
  const cache = new Map<string, Promise<ProvidedTree | null>>();
  return {
    provide: async (source) => {
      const key = `${source.owner}/${source.repo}@${source.sha}`;
      let p = cache.get(key);
      if (p === undefined) {
        p = load(source);
        cache.set(key, p);
      }
      return (await p)?.tree ?? null;
    },
    remove: () => removeAll(cache.values()),
  };
}
