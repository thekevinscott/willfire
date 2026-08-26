/**
 * A `RunCommand` that runs each step inside a hermetic docker container.
 *
 * Executing a job means running code willfire has no opinion about, and the
 * sandbox removes the trust question rather than answering it: no network, no
 * capabilities, no privilege escalation, a read-only root, and only the host
 * paths the step was explicitly handed (`RunSpec.mounts`), bound at their own
 * paths so nothing needs rewriting. Code that can reach nothing and keep
 * nothing needs no per-repo grant, which is what lets execution be on by
 * default instead of configured — the "no configuration" goal, applied to the
 * one place a grant used to live.
 *
 * The container runs as the invoking user (`--cap-drop ALL` removes
 * `CAP_DAC_OVERRIDE`, so root-in-container could not read the mounts anyway)
 * and `/tmp` is a tmpfs, both so writable mounts under the host's tmpdir keep
 * working and so nothing a step writes survives the run.
 *
 * The image is node:24-slim plus git — enough for `actions/checkout`'s
 * postcondition and every node action — built once from the inline dockerfile
 * and tagged by its hash, so a dockerfile change is a new image and an
 * unchanged one is a cache hit.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { RunCommand, RunSpec } from "./execute.js";

/**
 * The node major the image ships. Exported because it is also a *refusal
 * boundary*: a `setup-node` asking for a different major, or an action
 * declaring a different `node2x` runtime, cannot run truthfully in this
 * sandbox and must fail rather than run under the wrong node.
 */
export const SANDBOX_NODE_MAJOR = 24;

export const DOCKERFILE = `FROM node:${SANDBOX_NODE_MAJOR}-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
`;

export interface SandboxConfig {
  dockerBin: string;
  uid: number;
  gid: number;
  dockerfile: string;
}

/** Defaults resolved eagerly so the run path is branch-free. */
export function sandboxConfig(opts: Partial<SandboxConfig> = {}): SandboxConfig {
  return {
    dockerBin: opts.dockerBin ?? "docker",
    uid: opts.uid ?? process.getuid!(),
    gid: opts.gid ?? process.getgid!(),
    dockerfile: opts.dockerfile ?? DOCKERFILE,
  };
}

/** Content-addressed: the tag names the dockerfile that built it. */
export function imageTag(dockerfile: string): string {
  const hash = createHash("sha256").update(dockerfile).digest("hex");
  return `willfire-sandbox:${hash.slice(0, 12)}`;
}

/**
 * The complete `docker run` argv for one step, pure so the flags are
 * testable as data. `PATH` and `HOME` in `spec.env` are host facts seeded by
 * the executor; the container gets its image's `PATH` and a writable
 * `HOME=/tmp` instead. The trailing shell invocation mirrors `runShell`'s.
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

/**
 * One docker-client invocation. Unlike the sandboxed step, the client itself
 * runs with the host environment — it needs the host `PATH` and any
 * `DOCKER_HOST` to find the daemon.
 */
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
      // Keep the tail; a failure reason wants the last line, not a transcript.
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
 * Build a `RunCommand` that provisions the image on first use — inspect,
 * then build from the inline dockerfile on a miss — and runs every spec via
 * `sandboxArgv`. Provisioning happens once per runner and its failure is
 * remembered: every spec after it gets code 125 (docker's own "the run could
 * not start" band) with the reason, so each step fails honestly instead of
 * retrying a build that already failed.
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
