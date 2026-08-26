import { describe, expect, it } from "vitest";
import { runSteps } from "./runSteps.js";
import type { RunResult } from "./types.js";
import type { WalkCtx } from "./walkCtx.js";

const ctxOf = (run: () => Promise<RunResult>): WalkCtx => ({
  tree: "/nonexistent-workspace",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand: run,
    resolveRef: async () => null,
    nodeMajor: 24,
  },
  depth: 0,
});

const ok = async (): Promise<RunResult> => ({ code: 0, stderr: "" });

describe("runSteps", () => {
  it("walks run and uses steps, recording outputs under each id", async () => {
    const res = await runSteps(
      [
        { id: "c", uses: "actions/checkout@v6" },
        { id: "r", run: "true" },
        { run: "true" }, // id-less: runs, records nothing
      ],
      {},
      ctxOf(ok),
    );
    expect(res).toEqual({ ok: true, v: { c: { outputs: {} }, r: { outputs: {} } } });
  });

  it("skips a false step but still occupies its id", async () => {
    const res = await runSteps(
      [{ id: "skip", if: "false", run: "exit 1" }],
      {},
      ctxOf(async () => {
        throw new Error("must not run");
      }),
    );
    expect(res).toEqual({ ok: true, v: { skip: { outputs: {} } } });
  });

  it("stops on an if it cannot decide", async () => {
    const res = await runSteps([{ id: "s", if: "env.FOO", run: "true" }], {}, ctxOf(ok));
    expect(res).toEqual({ ok: false, reason: "cannot decide if: for step 's'" });
  });

  it("stops on a step with neither uses nor run", async () => {
    const res = await runSteps([{}], {}, ctxOf(ok));
    expect(res).toEqual({ ok: false, reason: "step '#1' has neither uses nor run" });
  });

  it("hands a failing step's reason through", async () => {
    const res = await runSteps(
      [{ name: "boom", run: "exit 1" }],
      {},
      ctxOf(async () => ({ code: 1, stderr: "bad\n" })),
    );
    expect(res).toEqual({ ok: false, reason: "step 'boom': exited 1 (bad)" });
  });
});
