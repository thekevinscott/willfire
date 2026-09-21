import { describe, expect, it } from "vitest";
import { removeAll } from "./removeAll.js";
import type { ProvidedTree } from "./types.js";

const tree = (name: string, removed: string[]): Promise<ProvidedTree> =>
  Promise.resolve({
    tree: name,
    remove: async () => {
      removed.push(name);
    },
  });

describe("removeAll", () => {
  it("removes every tree the cache holds", async () => {
    const removed: string[] = [];
    await removeAll([tree("a", removed), tree("b", removed)]);
    expect(removed).toEqual(["a", "b"]);
  });

  it("skips the entries that materialized nothing", async () => {
    const removed: string[] = [];
    await removeAll([Promise.resolve(null), tree("a", removed)]);
    expect(removed).toEqual(["a"]);
  });

  it("removes an entry still in flight when it is called", async () => {
    const removed: string[] = [];
    const slow = new Promise<ProvidedTree | null>((r) => {
      setTimeout(() => void r({ tree: "a", remove: async () => void removed.push("a") }), 1);
    });
    await removeAll([slow]);
    expect(removed).toEqual(["a"]);
  });
});
