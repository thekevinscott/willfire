import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runStepCommand } from "./runStepCommand.js";
import type { RunCommand, RunSpec } from "./types.js";

// Only to read the sink's path back out of a spec, and to see whether it
// survived; the real modules are what produced it, so the mocks pass through.
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);

const capture = (): { specs: RunSpec[]; cmd: RunCommand } => {
  const specs: RunSpec[] = [];
  const cmd: RunCommand = async (spec) => {
    specs.push(spec);
    return { code: 0, stdout: "", stderr: "" };
  };
  return { specs, cmd };
};

const args = (
  runCommand: RunCommand,
  actionRoot?: string,
): Parameters<typeof runStepCommand>[0] => ({
  runCommand,
  script: "true",
  shell: "bash",
  cwd: "/nonexistent-cwd",
  env: { K: "v" },
  tree: "/nonexistent-tree",
  actionRoot,
  label: "step 's'",
});

describe("runStepCommand", () => {
  it("mounts the tree and the output sink, and nothing else", async () => {
    const { specs, cmd } = capture();
    await runStepCommand(args(cmd));
    expect(specs[0].mounts).toEqual([
      { path: "/nonexistent-tree", writable: true },
      { path: dirname(specs[0].env.GITHUB_OUTPUT), writable: true },
    ]);
  });

  it("mounts the action root read-only, between the tree and the sink", async () => {
    const { specs, cmd } = capture();
    await runStepCommand(args(cmd, "/root"));
    expect(specs[0].mounts).toEqual([
      { path: "/nonexistent-tree", writable: true },
      { path: "/root", writable: false },
      { path: dirname(specs[0].env.GITHUB_OUTPUT), writable: true },
    ]);
  });

  it("passes the script, shell, cwd and env through untouched", async () => {
    const { specs, cmd } = capture();
    await runStepCommand(args(cmd));
    expect(specs[0].script).toBe("true");
    expect(specs[0].shell).toBe("bash");
    expect(specs[0].cwd).toBe("/nonexistent-cwd");
    expect(specs[0].env.K).toBe("v");
  });

  it("runs the command in the cwd, which need not be the mounted tree", async () => {
    const { specs, cmd } = capture();
    await runStepCommand({ ...args(cmd), cwd: "/nonexistent-tree/sub" });
    expect(specs[0].cwd).toBe("/nonexistent-tree/sub");
    expect(specs[0].mounts?.[0]).toEqual({ path: "/nonexistent-tree", writable: true });
  });

  it("reads outputs back from GITHUB_OUTPUT on exit 0", async () => {
    const cmd: RunCommand = async (spec) => {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(spec.env.GITHUB_OUTPUT, "who=bound\n");
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(await runStepCommand(args(cmd))).toEqual({ ok: true, v: { who: "bound" } });
  });

  it("reports the failure tail when the command exits non-zero", async () => {
    const cmd: RunCommand = async () => ({ code: 3, stdout: "", stderr: "boom\n" });
    expect(await runStepCommand(args(cmd))).toEqual({
      ok: false,
      reason: "step 's': exited 3\nboom",
    });
  });

  it("removes the output sink once the outputs are read back", async () => {
    const { specs, cmd } = capture();
    await runStepCommand(args(cmd));
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });

  it("removes the output sink even when the command throws", async () => {
    const specs: RunSpec[] = [];
    const cmd: RunCommand = async (spec) => {
      specs.push(spec);
      throw new Error("docker died");
    };
    await expect(runStepCommand(args(cmd))).rejects.toThrow("docker died");
    await expect(stat(dirname(specs[0].env.GITHUB_OUTPUT))).rejects.toThrow();
  });
});
