import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runNodeAction } from "./runNodeAction.js";
import type { ActionModel, RunCommand, RunSpec, WalkCtx } from "./types.js";

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

  it("stops on an env: layer it cannot render", async () => {
    const step = { env: { K: "${{ env.nope }}" } };
    const action = { runs: { using: "node24", main: "index.js" } };
    expect(
      await runNodeAction(step, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(ok)),
    ).toEqual({
      ok: false,
      reason: "step '#1': cannot resolve env 'K'",
    });
  });

  it("binds inputs over the env layers — an INPUT_* is not a step's to override", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      return { code: 0, stdout: "", stderr: "" };
    };
    const step = { with: { who: "bound" }, env: { INPUT_WHO: "layered" } };
    const action = {
      inputs: { who: { default: "" } },
      runs: { using: "node24", main: "index.js" },
    };
    await runNodeAction(step, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(cmd));
    expect(specs[0].env.INPUT_WHO).toBe("bound");
    expect(specs[0].env.WILLFIRE_ACTION_MAIN).toBe("/d/index.js");
  });

  it("mounts the directory holding GITHUB_OUTPUT writable", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      return { code: 0, stdout: "", stderr: "" };
    };
    const action = { runs: { using: "node24", main: "index.js" } };
    await runNodeAction({}, "step '#1'", "./a", action, "/d", "/root", 24, {}, ctxOf(cmd));
    expect(specs[0].mounts).toEqual([
      { path: "/nonexistent-tree", writable: true },
      { path: "/root", writable: false },
      { path: dirname(specs[0].env.GITHUB_OUTPUT), writable: true },
    ]);
  });

  it("removes the output sink once the outputs are read back", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      return { code: 0, stdout: "", stderr: "" };
    };
    const action = { runs: { using: "node24", main: "index.js" } };
    await runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(cmd));
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });

  it("removes the output sink even when the command throws", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      throw new Error("docker died");
    };
    const action = { runs: { using: "node24", main: "index.js" } };
    await expect(
      runNodeAction({}, "step '#1'", "./a", action, "/d", undefined, 24, {}, ctxOf(cmd)),
    ).rejects.toThrow("docker died");
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });
});
