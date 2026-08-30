import { afterEach, describe, expect, it, vi } from "vitest";
import { runRun } from "./runRun.js";
import type { RunCommand, RunSpec, WalkCtx } from "./types.js";

const ctxOf = (runCommand: RunCommand, extra: Partial<WalkCtx> = {}): WalkCtx => ({
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
  ...extra,
});

const ok: RunCommand = async () => ({ code: 0, stderr: "" });

/** Runs one step against a recording shell and hands back the spec it was given. */
async function specOf(step: unknown, scope = {}, extra: Partial<WalkCtx> = {}): Promise<RunSpec> {
  const seen: RunSpec[] = [];
  const record: RunCommand = async (spec) => {
    seen.push(spec);
    return { code: 0, stderr: "" };
  };
  const res = await runRun(step, "step 's'", scope, ctxOf(record, extra));
  expect(res).toEqual({ ok: true, v: {} });
  return seen[0];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("reports a non-zero exit with nothing on stderr as a bare code", async () => {
    const fail: RunCommand = async () => ({ code: 3, stderr: "  \n " });
    expect(await runRun({ run: "true" }, "step 's'", {}, ctxOf(fail))).toEqual({
      ok: false,
      reason: "step 's': exited 3",
    });
  });

  it("seeds the runner env from the host and the github scope", async () => {
    vi.stubEnv("PATH", "/host/bin");
    vi.stubEnv("HOME", "/host/home");
    const scope = { github: { repository: "o/r", event_name: "pull_request" } };
    const spec = await specOf({ run: "true" }, scope);
    expect(spec.env).toMatchObject({
      PATH: "/host/bin",
      HOME: "/host/home",
      GITHUB_WORKSPACE: "/nonexistent-tree",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_NAME: "pull_request",
    });
    // Outside a composite the var must be absent, not present and undefined.
    expect("GITHUB_ACTION_PATH" in spec.env).toBe(false);
  });

  it("falls back to an empty PATH and HOME when the host has neither", async () => {
    vi.stubEnv("PATH", undefined as never);
    vi.stubEnv("HOME", undefined as never);
    const spec = await specOf({ run: "true" });
    expect(spec.env.PATH).toBe("");
    expect(spec.env.HOME).toBe("");
  });

  it("mounts the workspace and the output dir, and nothing else", async () => {
    const spec = await specOf({ run: "true" });
    expect(spec.mounts).toHaveLength(2);
    expect(spec.mounts?.[0]).toEqual({ path: "/nonexistent-tree", writable: true });
    expect(spec.mounts?.[1]?.writable).toBe(true);
    expect(spec.env.GITHUB_OUTPUT.startsWith(`${spec.mounts?.[1]?.path}/`)).toBe(true);
  });

  it("mounts a remote action's repo read-only alongside them", async () => {
    const spec = await specOf({ run: "true" }, {}, { actionRoot: "/action-root" });
    expect(spec.mounts).toHaveLength(3);
    expect(spec.mounts?.[1]).toEqual({ path: "/action-root", writable: false });
  });
});
