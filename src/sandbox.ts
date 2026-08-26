/**
 * A `RunCommand` that runs each step inside a hermetic docker container: no
 * network, no capabilities, a read-only root, and only the host paths in
 * `RunSpec.mounts`, bound at their own paths. Code that can reach nothing and
 * keep nothing needs no per-repo grant — this is what lets execution be on by
 * default instead of configured.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { RunCommand, RunSpec } from "./execute/types.js";

/**
 * The node major the image ships — also the refusal boundary for `setup-node`
 * and `node2x` runtimes asking for any other major.
 */
export const SANDBOX_NODE_MAJOR = 24;

// git and python3: checkout's postcondition and the interpreters a script on
// a GitHub-hosted runner takes for granted.
export const DOCKERFILE = `FROM node:${SANDBOX_NODE_MAJOR}-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*
`;

export interface SandboxConfig {
  dockerBin: string;
  uid: number;
  gid: number;
  dockerfile: string;
}

export function sandboxConfig(opts: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    dockerBin: opts.dockerBin ?? "docker",
    uid: opts.uid ?? process.getuid!(),
    gid: opts.gid ?? process.getgid!(),
    dockerfile: opts.dockerfile ?? DOCKERFILE,
  };
}

/** The tag names the dockerfile that built it, so a change is a new image. */
export function imageTag(dockerfile: string): string {
  const hash = createHash("sha256").update(dockerfile).digest("hex");
  return `willfire-sandbox:${hash.slice(0, 12)}`;
}

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

// The client itself runs with the host environment — it needs the host PATH
// and any DOCKER_HOST to find the daemon.
function runDocker(
  bin: string,
  argv: string[],
  stdin?: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, argv, {
      env: process.env,
      stdio: [stdin == null ? "ignore" : "pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (d: Buffer) => {
      stderr += String(d);
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    child.on("spawn", () => {
      if (stdin != null) {
        child.stdin!.write(stdin);
        child.stdin!.end();
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
}

/**
 * Provisions the image lazily, once, and remembers a failure: every later
 * spec gets 125 (docker's "could not start" band) with the reason rather
 * than retrying a build that already failed.
 */
export function makeSandboxRunner(opts: Partial<SandboxConfig> = {}): RunCommand {
  const cfg = sandboxConfig(opts);
  const tag = imageTag(cfg.dockerfile);
  let ensured: Promise<string | null> | null = null;
  const ensureImage = (): Promise<string | null> => {
    ensured ??= (async () => {
      const inspect = await runDocker(cfg.dockerBin, ["image", "inspect", tag]);
      if (inspect.code === 0) return null;
      const build = await runDocker(cfg.dockerBin, ["build", "-t", tag, "-"], cfg.dockerfile);
      if (build.code === 0) return null;
      const trimmed = build.stderr.trim();
      const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
      return `cannot build sandbox image ${tag}${tail === "" ? "" : ` (${tail})`}`;
    })();
    return ensured;
  };
  return async (spec) => {
    const failure = await ensureImage();
    if (failure != null) return { code: 125, stderr: failure };
    return runDocker(cfg.dockerBin, sandboxArgv(spec, cfg));
  };
}
