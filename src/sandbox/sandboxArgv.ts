import type { RunSpec } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import type { SandboxConfig } from "./sandboxConfig.js";

/**
 * Consumption ceilings, deliberately far above any detect-shaped step: too
 * tight turns a legitimate job into a false `unknown`, which costs exactness.
 */
const MEMORY = "2g";
const PIDS = "512";
const CPUS = "2";
/** A tmpfs write is host memory, so `/tmp` — the container's `HOME` — needs its own. */
const TMPFS_SIZE = "1g";

/**
 * The complete `docker run` argv for one step. `PATH` and `HOME` in
 * `spec.env` are host facts; the container gets its image's PATH and a
 * writable `HOME=/tmp` instead. `name` is what a deadline kills by.
 */
export function sandboxArgv(spec: RunSpec, cfg: SandboxConfig, name: string): string[] {
  const argv = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--memory",
    MEMORY,
    "--pids-limit",
    PIDS,
    "--cpus",
    CPUS,
    // Docker keeps its nosuid/nodev/noexec defaults when an option is added.
    "--tmpfs",
    `/tmp:size=${TMPFS_SIZE}`,
    "--user",
    `${cfg.uid}:${cfg.gid}`,
  ];
  for (const m of spec.mounts ?? []) {
    argv.push("-v", `${m.path}:${m.path}${m.writable ? "" : ":ro"}`);
  }
  argv.push("-w", spec.cwd);
  for (const [k, v] of Object.entries(spec.env)) {
    if (k !== "PATH" && k !== "HOME") {
      argv.push("-e", `${k}=${v}`);
    }
  }
  argv.push("-e", "HOME=/tmp");
  argv.push(imageTag(cfg.dockerfile));
  if (spec.shell === "bash") {
    argv.push("bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", spec.script);
  } else {
    argv.push("sh", "-e", "-c", spec.script);
  }
  return argv;
}
