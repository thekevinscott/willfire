import { describe, expect, it } from "vitest";
import { runRun } from "./runRun.js";
import type { RunCommand, RunSpec, WalkCtx } from "./types.js";

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

const ok: RunCommand = async () => ({ code: 0, stdout: "", stderr: "" });

describe("runRun", () => {
  it("refuses a shell it does not model", async () => {
    expect(await runRun({ shell: "python", run: "pass" }, "step 's'", {}, ctxOf(ok))).toEqual({
      ok: false,
      reason: "step 's': shell 'python' is not modelled",
    });
  });

  it("stops on a run whose ${{ }} it cannot render", async () => {
    expect(await runRun({ run: "echo ${{ env.nope }}" }, "step 's'", {}, ctxOf(ok))).toEqual({
      ok: false,
      reason: "step 's': cannot resolve ${{ }} in run",
    });
  });

  it("reads outputs back from GITHUB_OUTPUT on exit 0", async () => {
    expect(await runRun({ run: "true" }, "step 's'", {}, ctxOf(ok))).toEqual({ ok: true, v: {} });
  });

  const capture = (): { specs: RunSpec[]; cmd: RunCommand } => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      return { code: 0, stdout: "", stderr: "" };
    };
    return { specs, cmd };
  };

  it("leaves GITHUB_ACTION_PATH unset outside a composite action", async () => {
    const { specs, cmd } = capture();
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd));
    expect(specs[0].env).not.toHaveProperty("GITHUB_ACTION_PATH");
  });

  it("points GITHUB_ACTION_PATH at the action and hands the root on to be mounted", async () => {
    const { specs, cmd } = capture();
    const ctx = { ...ctxOf(cmd), actionPath: "/root/a", actionRoot: "/root" };
    await runRun({ run: "true" }, "step 's'", {}, ctx);
    expect(specs[0].env.GITHUB_ACTION_PATH).toBe("/root/a");
    expect(specs[0].mounts).toContainEqual({ path: "/root", writable: false });
  });

  it("runs in the tree by default, and in working-directory resolved against it", async () => {
    const { specs, cmd } = capture();
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd));
    expect(specs[0].cwd).toBe("/nonexistent-tree");
    await runRun({ run: "true", "working-directory": "sub" }, "step 's'", {}, ctxOf(cmd));
    expect(specs[1].cwd).toBe("/nonexistent-tree/sub");
  });

  it("stops on an env: layer it cannot render", async () => {
    expect(
      await runRun({ run: "true", env: { K: "${{ env.nope }}" } }, "step 's'", {}, ctxOf(ok)),
    ).toEqual({ ok: false, reason: "step 's': cannot resolve env 'K'" });
  });

  it("stops on a working-directory it cannot render", async () => {
    const step = { run: "true", "working-directory": "${{ env.nope }}" };
    expect(await runRun(step, "step 's'", {}, ctxOf(ok))).toEqual({
      ok: false,
      reason: "step 's': cannot resolve working-directory",
    });
  });
});
