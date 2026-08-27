import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runRun } from "./runRun.js";
import type { ExecDeps, RunSpec, WalkCtx } from "./types.js";

const ok = async (): Promise<{ code: number; stderr: string }> => ({ code: 0, stderr: "" });

function ctxOf(runCommand: ExecDeps["runCommand"], extra: Partial<WalkCtx> = {}): WalkCtx {
  return {
    tree: "/ws",
    envLayers: [],
    deps: { runCommand, provideTree: async () => null, resolveRef: async () => null },
    depth: 0,
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runRun", () => {
  it("stops on a shell it does not model", async () => {
    const r = await runRun({ shell: "python", run: "pass" }, "step 's'", {}, ctxOf(ok));
    expect(r).toEqual({ ok: false, reason: "step 's': shell 'python' is not modelled" });
  });

  it("stops on a run whose ${{ }} it cannot render", async () => {
    const r = await runRun({ run: "echo ${{ env.nope }}" }, "step 's'", {}, ctxOf(ok));
    expect(r).toEqual({ ok: false, reason: "step 's': cannot resolve ${{ }} in run" });
  });

  it("assembles the env from the base, the layers, and the step", async () => {
    const specs: RunSpec[] = [];
    const capture: ExecDeps["runCommand"] = async (spec) => {
      specs.push(spec);
      return { code: 0, stderr: "" };
    };
    const ctx = ctxOf(capture, { envLayers: [{ A: "w" }], actionPath: "/act" });
    const scope = { inputs: { x: { kind: "value" as const, v: "i" } } };
    const r = await runRun({ run: "true", env: { B: "${{ inputs.x }}" } }, "step 's'", scope, ctx);
    expect(r).toEqual({ ok: true, v: {} });
    const [spec] = specs;
    expect(spec.shell).toBe("bash");
    expect(spec.cwd).toBe("/ws");
    expect(spec.env.A).toBe("w");
    expect(spec.env.B).toBe("i");
    expect(spec.env.GITHUB_WORKSPACE).toBe("/ws");
    expect(spec.env.GITHUB_ACTION_PATH).toBe("/act");
    expect(spec.env.GITHUB_OUTPUT).toMatch(/willfire-out-/);
  });

  it("stops on an env layer it cannot render, naming the step", async () => {
    const bad = await runRun({ run: "true" }, "step 's'", {}, ctxOf(ok, { envLayers: [[]] }));
    expect(bad).toEqual({ ok: false, reason: "step 's': env block is not a map" });
  });

  it("resolves working-directory against the tree, or stops", async () => {
    const specs: RunSpec[] = [];
    const capture: ExecDeps["runCommand"] = async (spec) => {
      specs.push(spec);
      return { code: 0, stderr: "" };
    };
    const r = await runRun({ run: "true", "working-directory": "sub" }, "step 's'", {}, ctxOf(capture));
    expect(r.ok).toBe(true);
    expect(specs[0].cwd).toBe("/ws/sub");
    const bad = await runRun(
      { run: "true", "working-directory": "${{ env.nope }}" },
      "step 's'",
      {},
      ctxOf(ok),
    );
    expect(bad).toEqual({ ok: false, reason: "step 's': cannot resolve working-directory" });
  });

  it("reports a non-zero exit with the last stderr line, when there is one", async () => {
    const loud = await runRun({ run: "x" }, "step 's'", {}, ctxOf(async () => ({ code: 3, stderr: "a\nboom" })));
    expect(loud).toEqual({ ok: false, reason: "step 's': exited 3 (boom)" });
    const quiet = await runRun({ run: "x" }, "step 's'", {}, ctxOf(async () => ({ code: 5, stderr: "" })));
    expect(quiet).toEqual({ ok: false, reason: "step 's': exited 5" });
  });

  it("parses what the script wrote to GITHUB_OUTPUT, or stops on garbage", async () => {
    const writing = (text: string): ExecDeps["runCommand"] => async (spec) => {
      await writeFile(spec.env.GITHUB_OUTPUT, text);
      return { code: 0, stderr: "" };
    };
    expect(await runRun({ run: "x" }, "step 's'", {}, ctxOf(writing("a=1\n")))).toEqual({
      ok: true,
      v: { a: "1" },
    });
    expect(await runRun({ run: "x" }, "step 's'", {}, ctxOf(writing("garbage\n")))).toEqual({
      ok: false,
      reason: "step 's': malformed GITHUB_OUTPUT",
    });
  });

  it("falls back to empty PATH and HOME when the parent has neither", async () => {
    vi.stubEnv("PATH", undefined);
    vi.stubEnv("HOME", undefined);
    const specs: RunSpec[] = [];
    const capture: ExecDeps["runCommand"] = async (spec) => {
      specs.push(spec);
      return { code: 0, stderr: "" };
    };
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(capture));
    expect(specs[0].env.PATH).toBe("");
    expect(specs[0].env.HOME).toBe("");
  });
});
