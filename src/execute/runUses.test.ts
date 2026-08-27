import { describe, expect, it } from "vitest";
import { runUses } from "./runUses.js";
import type { WalkCtx } from "./types.js";

const ctxOf = (depth = 0): WalkCtx => ({
  tree: "/nonexistent-tree",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand: async () => ({ code: 0, stderr: "" }),
    resolveRef: async (s) => s.ref,
    nodeMajor: 24,
  },
  depth,
});

describe("runUses", () => {
  it("satisfies a bare checkout as an already-true postcondition", async () => {
    expect(await runUses({ uses: "actions/checkout@v6" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: true,
      v: {},
    });
  });

  it("satisfies a bare setup-node", async () => {
    expect(await runUses({ uses: "actions/setup-node@v5" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: true,
      v: {},
    });
  });

  it("stops at the nesting cap before resolving the action", async () => {
    expect(await runUses({ uses: "./action" }, "step '#1'", {}, ctxOf(4))).toEqual({
      ok: false,
      reason: "step '#1': actions nested deeper than 4 levels",
    });
  });

  it("stops on a uses it cannot parse", async () => {
    expect(await runUses({ uses: "docker://alpine:3" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: false,
      reason: "step '#1': unresolvable uses: docker://alpine:3",
    });
  });
});
