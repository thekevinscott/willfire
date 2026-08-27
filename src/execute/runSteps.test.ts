import { describe, expect, it } from "vitest";
import { runSteps } from "./runSteps.js";
import type { RunCommand, WalkCtx } from "./types.js";

const ok: RunCommand = async () => ({ code: 0, stderr: "" });

const ctxOf = (runCommand: RunCommand = ok): WalkCtx => ({
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

describe("runSteps", () => {
  it("walks an empty step list to an empty context", async () => {
    expect(await runSteps([], {}, ctxOf())).toEqual({ ok: true, v: {} });
  });

  it("stops on a step with neither uses nor run", async () => {
    expect(await runSteps([null], {}, ctxOf())).toEqual({
      ok: false,
      reason: "step '#1' has neither uses nor run",
    });
  });

  it("stops on an if it cannot decide", async () => {
    expect(await runSteps([{ id: "s", if: "env.FOO", run: "true" }], {}, ctxOf())).toEqual({
      ok: false,
      reason: "cannot decide if: for step 's'",
    });
  });

  it("records a skipped step's id with no outputs", async () => {
    expect(await runSteps([{ id: "s", if: "false", run: "exit 1" }], {}, ctxOf())).toEqual({
      ok: true,
      v: { s: { outputs: {} } },
    });
  });

  it("records a run step's outputs under its id", async () => {
    expect(await runSteps([{ id: "s", run: "true" }], {}, ctxOf())).toEqual({
      ok: true,
      v: { s: { outputs: {} } },
    });
  });

  it("dispatches a uses step, recording nothing without an id", async () => {
    expect(await runSteps([{ uses: "actions/checkout@v6" }], {}, ctxOf())).toEqual({
      ok: true,
      v: {},
    });
  });
});
