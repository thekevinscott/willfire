import { describe, expect, it } from "vitest";
import { CHECKOUT_RE, MAX_ACTION_DEPTH, SETUP_NODE_RE, type WalkCtx } from "./walkCtx.js";

describe("walkCtx", () => {
  it("recognizes the runner-provided actions at any ref", () => {
    expect(CHECKOUT_RE.test("actions/checkout@v6")).toBe(true);
    expect(CHECKOUT_RE.test("someone/checkout@v6")).toBe(false);
    expect(SETUP_NODE_RE.test("actions/setup-node@v5")).toBe(true);
    expect(SETUP_NODE_RE.test("actions/setup-python@v5")).toBe(false);
  });

  it("caps action nesting", () => {
    expect(MAX_ACTION_DEPTH).toBe(4);
    const ctx: WalkCtx = {
      tree: "/w",
      hasHistory: false,
      envLayers: [],
      deps: {
        provideTree: async () => null,
        runCommand: async () => ({ code: 0, stderr: "" }),
        resolveRef: async () => null,
        nodeMajor: 24,
      },
      depth: 0,
    };
    expect(ctx.depth).toBeLessThan(MAX_ACTION_DEPTH);
  });
});
