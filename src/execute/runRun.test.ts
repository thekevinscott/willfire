import { describe, expect, it } from "vitest";
import { runRun } from "./runRun.js";
import type { RunResult, RunSpec } from "./types.js";
import type { WalkCtx } from "./walkCtx.js";

const ctxOf = (run: (spec: RunSpec) => Promise<RunResult>): WalkCtx => ({
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

describe("runRun", () => {
  it("refuses a shell it does not model", async () => {
    const res = await runRun({ shell: "python", run: "pass" }, "step '#1'", {}, ctxOf(ok));
    expect(res).toEqual({ ok: false, reason: "step '#1': shell 'python' is not modelled" });
  });

  it("stops on a run it cannot render", async () => {
    const res = await runRun({ run: "echo ${{ env.nope }}" }, "step '#1'", {}, ctxOf(ok));
    expect(res).toEqual({ ok: false, reason: "step '#1': cannot resolve ${{ }} in run" });
  });

  it("stops on a working-directory it cannot render", async () => {
    const step = { run: "true", "working-directory": "${{ env.nope }}" };
    const res = await runRun(step, "step '#1'", {}, ctxOf(ok));
    expect(res).toEqual({ ok: false, reason: "step '#1': cannot resolve working-directory" });
  });

  it("hands the rendered script to the runner with a fresh GITHUB_OUTPUT", async () => {
    const specs: RunSpec[] = [];
    const res = await runRun(
      { run: "true" },
      "step '#1'",
      {},
      ctxOf(async (spec) => {
        specs.push(spec);
        return { code: 0, stderr: "" };
      }),
    );
    expect(res).toEqual({ ok: true, v: {} });
    const [spec] = specs;
    expect(spec.script).toBe("true");
    expect(spec.env.GITHUB_OUTPUT.endsWith("/output")).toBe(true);
  });

  it("reports a failing script with its stderr tail", async () => {
    const res = await runRun(
      { run: "exit 3" },
      "step '#1'",
      {},
      ctxOf(async () => ({ code: 3, stderr: "warm-up\nboom\n" })),
    );
    expect(res).toEqual({ ok: false, reason: "step '#1': exited 3 (boom)" });
  });
});
