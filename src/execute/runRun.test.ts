import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("omits the parenthetical when stderr trims to nothing", async () => {
    const fail: RunCommand = async () => ({ code: 3, stderr: " \n " });
    expect(await runRun({ run: "true" }, "step 's'", {}, ctxOf(fail))).toEqual({
      ok: false,
      reason: "step 's': exited 3",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const capture = (): { specs: RunSpec[]; cmd: RunCommand } => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      return { code: 0, stderr: "" };
    };
    return { specs, cmd };
  };

  it("hands the runner the github env and exactly the tree and output mounts", async () => {
    const { specs, cmd } = capture();
    const scope = { github: { repository: "o/r", event_name: "pull_request" } };
    await runRun({ run: "true" }, "step 's'", scope, ctxOf(cmd));
    const spec = specs[0];
    expect(spec.env.GITHUB_REPOSITORY).toBe("o/r");
    expect(spec.env.GITHUB_EVENT_NAME).toBe("pull_request");
    expect(spec.env).not.toHaveProperty("GITHUB_ACTION_PATH");
    expect(spec.env.PATH).toBe(process.env.PATH);
    expect(spec.env.HOME).toBe(process.env.HOME);
    expect(spec.mounts).toEqual([
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

  it("gives PATH and HOME empty values when the host has neither", async () => {
    vi.stubEnv("PATH", undefined);
    vi.stubEnv("HOME", undefined);
    const { specs, cmd } = capture();
    await runRun({ run: "true" }, "step 's'", {}, ctxOf(cmd));
    expect(specs[0].env.PATH).toBe("");
    expect(specs[0].env.HOME).toBe("");
  });
});
