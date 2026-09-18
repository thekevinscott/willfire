import { spawnCollect } from "../spawnCollect.js";
import type { RunCommand } from "./types.js";

/**
 * The runner's default shell invocations, faithfully. Nothing of the parent
 * environment leaks in beyond what the spec names.
 */
export const runShell: RunCommand = async (spec) => {
  const argv =
    spec.shell === "bash"
      ? ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", spec.script]
      : ["-e", "-c", spec.script];
  const r = await spawnCollect(spec.shell, argv, { cwd: spec.cwd, env: spec.env });
  // A shell that never started is an unrunnable command, which is 127.
  return "failed" in r ? { code: 127, stdout: "", stderr: "" } : r;
};
