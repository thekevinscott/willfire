import type { RunSpec } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import type { SandboxConfig } from "./sandboxConfig.js";
import type { StateVolumes } from "./stateVolumes.js";

/**
 * The complete `docker run` argv for one step. `PATH` and `HOME` in
 * `spec.env` are host facts; the container gets its image's PATH and a
 * writable `HOME=/tmp` instead. `name` is what a deadline kills by. Network
 * stays open, as on GitHub's own runners; the isolation is filesystem and
 * env, not egress.
 */
export function sandboxArgv(
  spec: RunSpec,
  cfg: SandboxConfig,
  name: string,
  state?: StateVolumes,
): string[] {
  const argv = [
    "run",
    "--rm",
    "--name",
    name,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    // Ceilings far above any detect-shaped step: too tight turns a legitimate
    // job into a false `unknown`, which costs exactness.
    "--memory",
    "2g",
    "--pids-limit",
    "512",
    "--cpus",
    "2",
  ];
  if (state === undefined) {
    // A tmpfs write is host memory, and `/tmp` is the container's HOME. Docker
    // keeps its nosuid/nodev/noexec defaults when an option is added.
    argv.push("--tmpfs", "/tmp:size=1g");
  } else {
    // The job's machine state, outliving this step's container: docker
    // populates an empty named volume from the image (so /usr/local keeps its
    // node), and the next step with the same key mounts the accreted result.
    argv.push("-v", `${state.usr}:/usr/local`, "-v", `${state.tmp}:/tmp`);
  }
  argv.push("--user", `${cfg.uid}:${cfg.gid}`);
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
