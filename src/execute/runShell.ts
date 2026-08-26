import { spawn } from "node:child_process";
import type { RunCommand } from "./types.js";

/**
 * The runner's default shell invocations, faithfully. Nothing of the parent
 * environment leaks in beyond what the spec names.
 */
export const runShell: RunCommand = (spec) =>
  new Promise((resolvePromise) => {
    const argv =
      spec.shell === "bash"
        ? ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", spec.script]
        : ["-e", "-c", spec.script];
    const child = spawn(spec.shell, argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += String(d);
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
