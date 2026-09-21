import type { ProvidedTree } from "./types.js";

/** Remove every tree a provider's cache holds, in-flight ones included. */
export async function removeAll(
  pending: Iterable<Promise<ProvidedTree | null>>,
): Promise<void> {
  for (const p of pending) {
    await (await p)?.remove();
  }
}
