import type { RunCommand } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import { runDocker } from "./runDocker.js";
import { sandboxArgv } from "./sandboxArgv.js";
import { sandboxConfig, type SandboxConfig } from "./sandboxConfig.js";

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
    if (failure != null) {
      return { code: 125, stderr: failure };
    }
    return runDocker(cfg.dockerBin, sandboxArgv(spec, cfg));
  };
}
