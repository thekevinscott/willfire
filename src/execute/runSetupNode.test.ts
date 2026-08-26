import { describe, expect, it } from "vitest";
import { runSetupNode } from "./runSetupNode.js";
import type { WalkCtx } from "./walkCtx.js";

const ctx = { deps: { nodeMajor: 24 } } as WalkCtx;

describe("runSetupNode", () => {
  it("is satisfied bare, or asking for the sandbox's node in any spelling", () => {
    expect(runSetupNode({}, "step '#1'", {}, ctx)).toEqual({ ok: true, v: {} });
    for (const v of ["24", "v24.1", 24]) {
      const step = { with: { "node-version": v } };
      expect(runSetupNode(step, "step '#1'", {}, ctx)).toEqual({ ok: true, v: {} });
    }
  });

  it("refuses any other node, majors and unreadable versions alike", () => {
    for (const v of [20, "latest"]) {
      const step = { with: { "node-version": v } };
      expect(runSetupNode(step, "step '#1'", {}, ctx)).toEqual({
        ok: false,
        reason: `step '#1': setup-node wants node ${v}; the sandbox has node 24`,
      });
    }
  });

  it("stops on a node-version it cannot resolve", () => {
    const step = { with: { "node-version": "${{ env.nope }}" } };
    expect(runSetupNode(step, "step '#1'", {}, ctx)).toEqual({
      ok: false,
      reason: "step '#1': cannot resolve node-version",
    });
  });

  it("refuses inputs beyond node-version", () => {
    for (const withBlock of [{ "node-version": "24", cache: "pnpm" }, { cache: "pnpm" }]) {
      expect(runSetupNode({ with: withBlock }, "step '#1'", {}, ctx)).toEqual({
        ok: false,
        reason: "step '#1': setup-node with inputs beyond node-version is not modelled",
      });
    }
  });
});
