import { describe, expect, it } from "vitest";
import { cachedByKey } from "./cachedByKey.js";
import type { WorkflowSource } from "../types.js";
import type { ProvidedTree } from "./types.js";

const SHA = "c".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

/** A load that names each tree after the source it was asked for, and counts. */
const counting = (): {
  load: (s: WorkflowSource) => Promise<ProvidedTree | null>;
  seen: WorkflowSource[];
  removed: string[];
} => {
  const seen: WorkflowSource[] = [];
  const removed: string[] = [];
  const load = async (s: WorkflowSource): Promise<ProvidedTree> => {
    seen.push(s);
    const tree = `/tree/${seen.length}`;
    return { tree, remove: async () => void removed.push(tree) };
  };
  return { load, seen, removed };
};

describe("cachedByKey", () => {
  it("loads once per commit and serves the same tree to every later asker", async () => {
    const { load, seen } = counting();
    const src = cachedByKey(load);
    const first = await src.provide(SOURCE);
    expect(await src.provide(SOURCE)).toBe(first);
    expect(seen).toHaveLength(1);
  });

  it("keys on the sha, so two commits of one repo are two loads", async () => {
    const { load, seen } = counting();
    const src = cachedByKey(load);
    const a = await src.provide(SOURCE);
    const b = await src.provide({ ...SOURCE, sha: "d".repeat(40) });
    expect(b).not.toBe(a);
    expect(seen).toHaveLength(2);
  });

  it("keys on the owner and the repo, not the sha alone", async () => {
    const { load, seen } = counting();
    const src = cachedByKey(load);
    await src.provide(SOURCE);
    await src.provide({ ...SOURCE, owner: "o2" });
    await src.provide({ ...SOURCE, repo: "r2" });
    expect(seen).toHaveLength(3);
  });

  it("ignores the ref, which is only how the sha was named", async () => {
    const { load, seen } = counting();
    const src = cachedByKey(load);
    const first = await src.provide(SOURCE);
    expect(await src.provide({ ...SOURCE, ref: "main" })).toBe(first);
    expect(seen).toHaveLength(1);
  });

  it("caches a load that yielded nothing, rather than retrying it per asker", async () => {
    const seen: WorkflowSource[] = [];
    const src = cachedByKey(async (s) => {
      seen.push(s);
      return null;
    });
    expect(await src.provide(SOURCE)).toBe(null);
    expect(await src.provide(SOURCE)).toBe(null);
    expect(seen).toHaveLength(1);
  });

  it("hands one load to concurrent askers rather than racing two", async () => {
    const { load, seen } = counting();
    const src = cachedByKey(load);
    const [a, b] = await Promise.all([src.provide(SOURCE), src.provide(SOURCE)]);
    expect(b).toBe(a);
    expect(seen).toHaveLength(1);
  });

  it("removes every tree the cache holds, not only the last", async () => {
    const { load, removed } = counting();
    const src = cachedByKey(load);
    await src.provide(SOURCE);
    await src.provide({ ...SOURCE, owner: "o2" });
    await src.remove();
    expect(removed).toEqual(["/tree/1", "/tree/2"]);
  });

  it("has nothing to remove when nothing was loaded", async () => {
    const { load, removed } = counting();
    await expect(cachedByKey(load).remove()).resolves.toBeUndefined();
    expect(removed).toEqual([]);
  });

  it("removes a load still in flight when remove is called", async () => {
    const removed: string[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const src = cachedByKey(async () => {
      await gate;
      return { tree: "/tree/slow", remove: async () => void removed.push("/tree/slow") };
    });
    const inFlight = src.provide(SOURCE);
    const removal = src.remove();
    release();
    await inFlight;
    await removal;
    expect(removed).toEqual(["/tree/slow"]);
  });
});
