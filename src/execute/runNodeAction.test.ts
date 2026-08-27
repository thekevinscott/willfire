import { describe, expect, it } from "vitest";
import { runNodeAction } from "./runNodeAction.js";
import type { RunCommand, WalkCtx } from "./types.js";

const ctxOf = (runCommand: RunCommand): WalkCtx => ({
  tree: "/nonexistent-tree",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand,
    resolveRef: async (s) => s.ref,
    nodeMajor: 24,
  },
  depth: 0,
});

const ok: RunCommand = async () => ({ code: 0, stderr: "" });

describe("runNodeAction", () => {
  it("refuses an action wanting another node", async () => {
    const action = { runs: { using: "node20", main: "index.js" } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 20, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': action ./a wants node 20; the sandbox has node 24",
    });
  });

  it("refuses an action that declares a pre: step", async () => {
    const action = { runs: { using: "node24", main: "index.js", pre: "setup.js" } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': action ./a declares a pre: step; not modelled",
    });
  });

  it("refuses an action with no runs.main", async () => {
    const action = { runs: { using: "node24" } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': action ./a has no runs.main",
    });
  });

  it("runs main and reads its outputs back from GITHUB_OUTPUT", async () => {
    const action = { runs: { using: "node24", main: "index.js" } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({ ok: true, v: {} });
  });
});
