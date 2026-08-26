/**
 * A `RunCommand` that runs each step inside a hermetic docker container: no
 * network, no capabilities, a read-only root, and only the host paths in
 * `RunSpec.mounts`, bound at their own paths. Code that can reach nothing and
 * keep nothing needs no per-repo grant — this is what lets execution be on by
 * default instead of configured.
 */

export { imageTag } from "./imageTag.js";
export { makeSandboxRunner } from "./makeSandboxRunner.js";
export { sandboxArgv } from "./sandboxArgv.js";
export { DOCKERFILE, SANDBOX_NODE_MAJOR, sandboxConfig } from "./sandboxConfig.js";
export type { SandboxConfig } from "./sandboxConfig.js";
