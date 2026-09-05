import { describe, expect, it } from "vitest";
import { runNodeAction } from "./runNodeAction.js";
import type { ActionModel, RunCommand, WalkCtx } from "./types.js";

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

  it("treats an explicit `pre: null` as no pre: step", async () => {
    const action = { runs: { using: "node24", main: "index.js", pre: null } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({ ok: true, v: {} });
  });

  it("refuses an action with no runs block at all", async () => {
    expect(
      await runNodeAction({}, "step '#1'", "./a", {}, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': action ./a has no runs.main",
    });
  });

  it("refuses a null action — YAML parses an empty manifest to null", async () => {
    const action = null as unknown as ActionModel;
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': action ./a has no runs.main",
    });
  });

  it("reports a non-zero exit with the last stderr line only", async () => {
    const fail: RunCommand = async () => ({ code: 2, stderr: "one\nboom\n" });
    const action = { runs: { using: "node24", main: "index.js" } };
    expect(
      await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(fail)),
    ).toEqual({
      ok: false,
      reason: "step '#1': exited 2 (boom)",
    });
  });
});
