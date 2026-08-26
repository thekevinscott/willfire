import { describe, expect, it } from "vitest";
import { runUses } from "./runUses.js";
import type { ExecDeps } from "./types.js";
import type { WalkCtx } from "./walkCtx.js";

const ctxOf = (overrides: Partial<ExecDeps> = {}, depth = 0): WalkCtx => ({
  tree: "/nonexistent-workspace",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand: async () => ({ code: 0, stderr: "" }),
    resolveRef: async () => null,
    nodeMajor: 24,
    ...overrides,
  },
  depth,
});

describe("runUses", () => {
  it("dispatches the runner-provided actions without materializing anything", async () => {
    const step = { uses: "actions/checkout@v6" };
    expect(await runUses(step, "step '#1'", {}, ctxOf())).toEqual({ ok: true, v: {} });
    const node = { uses: "actions/setup-node@v5" };
    expect(await runUses(node, "step '#1'", {}, ctxOf())).toEqual({ ok: true, v: {} });
  });

  it("stops at the nesting cap before resolving anything", async () => {
    const res = await runUses({ uses: "o/a@v1" }, "step '#1'", {}, ctxOf({}, 4));
    expect(res).toEqual({ ok: false, reason: "step '#1': actions nested deeper than 4 levels" });
  });

  it("stops on a uses it cannot parse", async () => {
    const res = await runUses({ uses: "docker://alpine:3" }, "step '#1'", {}, ctxOf());
    expect(res).toEqual({ ok: false, reason: "step '#1': unresolvable uses: docker://alpine:3" });
  });

  it("stops when the ref does not resolve", async () => {
    const res = await runUses({ uses: "o/a@v1" }, "step '#1'", {}, ctxOf());
    expect(res).toEqual({ ok: false, reason: "step '#1': cannot resolve ref for o/a@v1" });
  });

  it("takes a sha ref as already resolved, then stops when no tree comes", async () => {
    const sha = "a".repeat(40);
    const resolveRef = async (): Promise<string | null> => {
      throw new Error("must not resolve a sha");
    };
    const res = await runUses({ uses: `o/a@${sha}` }, "step '#1'", {}, ctxOf({ resolveRef }));
    expect(res).toEqual({ ok: false, reason: `step '#1': cannot materialize o/a@${sha}` });
  });

  it("stops on a local action with no manifest", async () => {
    const res = await runUses({ uses: "./missing" }, "step '#1'", {}, ctxOf());
    expect(res).toEqual({ ok: false, reason: "step '#1': no action.yml under ./missing" });
  });
});
