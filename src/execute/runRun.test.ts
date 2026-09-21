import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runRun } from "./runRun.js";
import type { RunCommand, RunSpec, WalkCtx } from "./types.js";

// Only to read the sink's path back out of a spec, and to see whether it
// survived; the real modules are what produced it, so the mocks pass through.
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);

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
      { path: dirname(specs[0].env.GITHUB_OUTPUT), writable: true },
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
      { path: dirname(specs[0].env.GITHUB_OUTPUT), writable: true },
    ]);
  });

  it("stops on an env: layer it cannot render", async () => {
    expect(
      await runRun({ run: "true", env: { K: "${{ env.nope }}" } }, "step 's'", {}, ctxOf(ok)),
    ).toEqual({ ok: false, reason: "step 's': cannot resolve env 'K'" });
  });

  it("removes the output sink once the outputs are read back", async () => {
    const { specs, cmd } = capture();
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd));
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });

  it("removes the output sink even when the command throws", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      throw new Error("docker died");
    };
    await expect(runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd))).rejects.toThrow("docker died");
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });
});
