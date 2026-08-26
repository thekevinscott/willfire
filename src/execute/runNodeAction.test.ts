import { describe, expect, it } from "vitest";
import { runNodeAction } from "./runNodeAction.js";
import type { WalkCtx } from "./walkCtx.js";

const ctx = {
  tree: "/nonexistent-workspace",
  hasHistory: false,
  envLayers: [],
  deps: { nodeMajor: 24 },
  depth: 0,
} as unknown as WalkCtx;

const run = (
  step: any,
  action: any,
  usingMajor = 24,
): ReturnType<typeof runNodeAction> =>
  runNodeAction(step, "step '#1'", "./a", action, "/a", undefined, usingMajor, {}, ctx);

describe("runNodeAction", () => {
  it("refuses another node major", async () => {
    expect(await run({}, { runs: { using: "node20", main: "i.js" } }, 20)).toEqual({
      ok: false,
      reason: "step '#1': action ./a wants node 20; the sandbox has node 24",
    });
  });

  it("refuses a declared pre: step", async () => {
    expect(await run({}, { runs: { using: "node24", main: "i.js", pre: "p.js" } })).toEqual({
      ok: false,
      reason: "step '#1': action ./a declares a pre: step; not modelled",
    });
  });

  it("refuses a manifest with no runs.main", async () => {
    expect(await run({}, { runs: { using: "node24" } })).toEqual({
      ok: false,
      reason: "step '#1': action ./a has no runs.main",
    });
  });

  it("stops on an env or input it cannot resolve, before running anything", async () => {
    const action = { runs: { using: "node24", main: "i.js" } };
    expect(await run({ env: { B: "${{ env.nope }}" } }, action)).toEqual({
      ok: false,
      reason: "step '#1': cannot resolve env 'B'",
    });
    expect(await run({ with: { who: "${{ env.nope }}" } }, action)).toEqual({
      ok: false,
      reason: "step '#1': cannot resolve input 'who' of ./a",
    });
  });
});
