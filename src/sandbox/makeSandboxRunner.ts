/**
 * A `RunCommand` that runs each step inside a hermetic docker container: no
 * network, no capabilities, a read-only root, and only the host paths in
 * `RunSpec.mounts`, bound at their own paths. Code that can reach nothing and
 * keep nothing needs no per-repo grant — this is what lets execution be on by
 * default instead of configured.
 */

import { randomUUID } from "node:crypto";
import type { RunCommand } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import { runDocker } from "./runDocker.js";
import { sandboxArgv } from "./sandboxArgv.js";
import { sandboxConfig, type SandboxConfig } from "./sandboxConfig.js";

/**
 * Wall clock one step gets — orders of magnitude above a detect step, since a
 * false deadline costs exactness while a hung one only costs the run.
 */
const DEADLINE_MS = 10 * 60 * 1000;

/** `timeout(1)`'s exit code, so a deadline reads as one through the failure tail. */
const TIMED_OUT = 124;

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
      if (inspect.code === 0) {
        return null;
      }
      const build = await runDocker(cfg.dockerBin, ["build", "-t", tag, "-"], cfg.dockerfile);
      if (build.code === 0) {
        return null;
      }
      const trimmed = build.stderr.trim();
      const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
      return `cannot build sandbox image ${tag}${tail === "" ? "" : ` (${tail})`}`;
    })();
    return ensured;
  };
  return async (spec) => {
    const failure = await ensureImage();
    if (failure !== null) {
      return { code: 125, stdout: "", stderr: failure };
    }
    const name = `willfire-${randomUUID()}`;
    let expired = false;
    // The daemon owns the container, not the client, so killing the `docker
    // run` process would orphan it: the deadline kills by name instead.
    const deadline = setTimeout(() => {
      expired = true;
      void runDocker(cfg.dockerBin, ["kill", name]);
    }, DEADLINE_MS);
    try {
      const r = await runDocker(cfg.dockerBin, sandboxArgv(spec, cfg, name));
      return expired
        ? { code: TIMED_OUT, stdout: "", stderr: `killed after ${DEADLINE_MS / 1000}s` }
        : r;
    } finally {
      clearTimeout(deadline);
    }
  };
}
