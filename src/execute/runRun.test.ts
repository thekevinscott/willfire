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

  it("mounts the tree and the output sink, and nothing else", async () => {
    const { specs, cmd } = capture();
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd));
    expect(specs[0].env).not.toHaveProperty("GITHUB_ACTION_PATH");
    expect(specs[0].mounts).toEqual([
      { path: "/nonexistent-tree", writable: true },
      { path: expect.stringContaining("willfire-out-"), writable: true },
    ]);
  });

  it("mounts the action root read-only and points GITHUB_ACTION_PATH at the action", async () => {
    const { specs, cmd } = capture();
    const ctx = { ...ctxOf(cmd), actionPath: "/root/a", actionRoot: "/root" };
    await runRun({ run: "true" }, "step 's'", {}, ctx);
    expect(specs[0].env.GITHUB_ACTION_PATH).toBe("/root/a");
    expect(specs[0].mounts).toEqual([
      { path: "/nonexistent-tree", writable: true },
      { path: "/root", writable: false },
      { path: expect.stringContaining("willfire-out-"), writable: true },
    ]);
  });

  it("stops on an env: layer it cannot render", async () => {
    expect(
      await runRun({ run: "true", env: { K: "${{ env.nope }}" } }, "step 's'", {}, ctxOf(ok)),
    ).toEqual({ ok: false, reason: "step 's': cannot resolve env 'K'" });
  });
});
