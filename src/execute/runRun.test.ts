import { describe, expect, it } from "vitest";
import { runRun } from "./runRun.js";
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

  it("reports a non-zero exit with the last stderr line", async () => {
    const fail: RunCommand = async () => ({ code: 3, stderr: "one\nboom\n" });
    expect(await runRun({ run: "true" }, "step 's'", {}, ctxOf(fail))).toEqual({
      ok: false,
      reason: "step 's': exited 3 (boom)",
    });
  });
});
