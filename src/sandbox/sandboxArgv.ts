import type { RunSpec } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import type { SandboxConfig } from "./sandboxConfig.js";

/**
 * The complete `docker run` argv for one step. `PATH` and `HOME` in
 * `spec.env` are host facts; the container gets its image's PATH and a
 * writable `HOME=/tmp` instead.
 */
export function sandboxArgv(spec: RunSpec, cfg: SandboxConfig): string[] {
  const argv = [
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--user",
    `${cfg.uid}:${cfg.gid}`,
  ];
  for (const m of spec.mounts ?? []) {
    argv.push("-v", `${m.path}:${m.path}${m.writable ? "" : ":ro"}`);
  }
  argv.push("-w", spec.cwd);
  for (const [k, v] of Object.entries(spec.env)) {
    if (k === "PATH" || k === "HOME") continue;
    argv.push("-e", `${k}=${v}`);
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
