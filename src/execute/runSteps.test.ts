import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runSteps } from "./runSteps.js";
import type { ExecDeps, WalkCtx } from "./types.js";

function ctxOf(runCommand?: ExecDeps["runCommand"]): WalkCtx {
  return {
    tree: "/ws",
    envLayers: [],
    deps: {
      runCommand: runCommand ?? (async () => ({ code: 0, stderr: "" })),
      provideTree: async () => null,
      resolveRef: async () => null,
    },
    depth: 0,
  };
}

describe("runSteps", () => {
  it("walks each step and records its outputs under its id", async () => {
    const r = await runSteps([{ id: "s", run: "true" }], {}, ctxOf());
    expect(r).toEqual({ ok: true, v: { s: { outputs: {} } } });
  });

  it("lets a later if: read an earlier step's outputs", async () => {
    const writing: ExecDeps["runCommand"] = async (spec) => {
      await writeFile(spec.env.GITHUB_OUTPUT, "x=1\n");
      return { code: 0, stderr: "" };
    };
    const r = await runSteps(
      [
        { id: "a", run: "true" },
        { id: "b", if: "steps.a.outputs.x == '1'", run: "true" },
      ],
      {},
      ctxOf(writing),
    );
    expect(r.ok).toBe(true);
  });

  it("skips a false if:, the step occupying its id with no outputs", async () => {
    const r = await runSteps([{ id: "a", if: "false", run: "exit 1" }], {}, ctxOf());
    expect(r).toEqual({ ok: true, v: { a: { outputs: {} } } });
    const anonymous = await runSteps([{ if: "false", run: "exit 1" }], {}, ctxOf());
    expect(anonymous).toEqual({ ok: true, v: {} });
  });

  it("stops on an if it cannot decide", async () => {
    const r = await runSteps([{ id: "s", if: "env.FOO", run: "true" }], {}, ctxOf());
    expect(r).toEqual({ ok: false, reason: "cannot decide if: for step 's'" });
  });

  it("labels a step by id, then name, then position", async () => {
    expect(await runSteps([{}], {}, ctxOf())).toEqual({
      ok: false,
      reason: "step '#1' has neither uses nor run",
    });
    expect(await runSteps([{ name: "n" }], {}, ctxOf())).toEqual({
      ok: false,
      reason: "step 'n' has neither uses nor run",
    });
  });

  it("routes uses: steps to the action path", async () => {
    const r = await runSteps([{ id: "c", uses: "actions/checkout@v6" }], {}, ctxOf());
    expect(r).toEqual({ ok: true, v: { c: { outputs: {} } } });
  });
});
