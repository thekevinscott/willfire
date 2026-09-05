import { describe, expect, it } from "vitest";
import { runUses } from "./runUses.js";
import type { WalkCtx } from "./types.js";

const ctxOf = (over: Partial<WalkCtx> = {}, deps: Partial<WalkCtx["deps"]> = {}): WalkCtx => ({
  tree: "/nonexistent-tree",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand: async () => ({ code: 0, stderr: "" }),
    resolveRef: async (s) => s.ref,
    nodeMajor: 24,
    ...deps,
  },
  depth: 0,
  ...over,
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

  it("treats a repo merely containing actions/setup-node as an ordinary action", async () => {
    const o = await runUses({ uses: "evil/actions/setup-node@v4" }, "step '#1'", {}, ctxOf());
    expect(o).toEqual({
      ok: false,
      reason: "step '#1': cannot materialize evil/actions@v4",
    });
  });

  it("accepts a padded or minor-qualified node-version naming the sandbox major", async () => {
    for (const v of [" 24 ", "24.10"]) {
      const step = { uses: "actions/setup-node@v5", with: { "node-version": v } };
      expect(await runUses(step, "step '#1'", {}, ctxOf())).toEqual({ ok: true, v: {} });
    }
  });

  it("refuses a node-version that only contains the major somewhere inside", async () => {
    for (const v of ["24x", "x24"]) {
      const step = { uses: "actions/setup-node@v5", with: { "node-version": v } };
      expect(await runUses(step, "step '#1'", {}, ctxOf())).toEqual({
        ok: false,
        reason: `step '#1': setup-node wants node ${v}; the sandbox has node 24`,
      });
    }
  });

  it("materializes a 40-hex ref as the commit itself, without the resolver", async () => {
    const sha = "a".repeat(40);
    const ctx = ctxOf({}, { resolveRef: async () => null });
    expect(await runUses({ uses: `o/r@${sha}` }, "step '#1'", {}, ctx)).toEqual({
      ok: false,
      reason: `step '#1': cannot materialize o/r@${sha}`,
    });
  });

  it("resolves any ref that is not exactly 40 hex characters", async () => {
    const ctx = ctxOf({}, { resolveRef: async () => null });
    for (const ref of [`z${"a".repeat(40)}`, "a".repeat(41)]) {
      expect(await runUses({ uses: `o/r@${ref}` }, "step '#1'", {}, ctx)).toEqual({
        ok: false,
        reason: `step '#1': cannot resolve ref for o/r@${ref}`,
      });
    }
  });

  it("still resolves an action at the fourth nesting level", async () => {
    expect(await runUses({ uses: "./action" }, "step '#1'", {}, ctxOf({ depth: 3 }))).toEqual({
      ok: false,
      reason: "step '#1': no action.yml under ./action",
    });
  });

  it("stops at the nesting cap before resolving the action", async () => {
    expect(await runUses({ uses: "./action" }, "step '#1'", {}, ctxOf({ depth: 4 }))).toEqual({
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
