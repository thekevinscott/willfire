/**
 * A `RunCommand` that runs each step inside a docker container: no
 * capabilities, a read-only root, none of the host's env or credentials, and
 * only the host paths in `RunSpec.mounts`, bound at their own paths. Network
 * stays open — GitHub's runners give steps network, and installs are how jobs
 * bootstrap. Code that can keep nothing and carries no credentials needs no
 * per-repo grant — this is what lets execution be on by default.
 *
 * Specs sharing a `stateKey` share `/usr/local` and `/tmp` through named
 * volumes, so a job's steps see one machine the way a runner's do; `dispose`
 * removes every volume once the prediction is over.
 */

import { randomUUID } from "node:crypto";
import type { RunCommand } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import { runDocker } from "./runDocker.js";
import { sandboxArgv } from "./sandboxArgv.js";
import { sandboxConfig, type SandboxConfig } from "./sandboxConfig.js";
import { stateVolumes, type StateVolumes } from "./stateVolumes.js";

/**
 * Ten minutes of wall clock per step — orders of magnitude above a detect
 * step, since a false deadline costs exactness while a hung one costs a run.
 */
const DEADLINE_MS = 600_000;

/** `timeout(1)`'s exit code, so a deadline reads as one through the failure tail. */
const TIMED_OUT = 124;

export interface SandboxRunner {
  run: RunCommand;
  /** Remove every state volume the runs created. Once, after the last run. */
  dispose: () => Promise<void>;
}

/**
 * Provisions the image lazily, once, and remembers a failure: every later
 * spec gets 125 (docker's "could not start" band) with the reason rather
 * than retrying a build that already failed.
 */
export function makeSandboxRunner(opts: Partial<SandboxConfig> = {}): SandboxRunner {
  const cfg = sandboxConfig(opts);
  const tag = imageTag(cfg.dockerfile);
  const states = new Map<string, StateVolumes>();
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
  const run: RunCommand = async (spec) => {
    const failure = await ensureImage();
    if (failure !== null) {
      return { code: 125, stdout: "", stderr: failure };
    }
    let state: StateVolumes | undefined;
    if (spec.stateKey !== undefined) {
      state = states.get(spec.stateKey);
      if (state === undefined) {
        state = stateVolumes(spec.stateKey);
        states.set(spec.stateKey, state);
      }
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
      const r = await runDocker(cfg.dockerBin, sandboxArgv(spec, cfg, name, state));
      return expired
        ? { code: TIMED_OUT, stdout: "", stderr: `killed after ${DEADLINE_MS / 1000}s` }
        : r;
    } finally {
      clearTimeout(deadline);
    }
  };
  return {
    run,
    dispose: async () => {
      const names = [...states.values()].flatMap((s) => [s.usr, s.tmp]);
      states.clear();
      if (names.length > 0) {
        await runDocker(cfg.dockerBin, ["volume", "rm", "-f", ...names]);
      }
    },
  };
}
