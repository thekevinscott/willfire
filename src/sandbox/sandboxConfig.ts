/** Also the refusal boundary: `setup-node` and `node2x` get no other major. */
export const SANDBOX_NODE_MAJOR = 24;

// git and python3: checkout's postcondition and the interpreters a script on
// a GitHub-hosted runner takes for granted. The chmod matches GitHub's runner
// images, where /usr/local is user-writable so `npm install -g` needs no sudo;
// dirs only, so no file contents copy up into the layer.
export const DOCKERFILE = `FROM node:${SANDBOX_NODE_MAJOR}-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*
RUN find /usr/local -type d -exec chmod a+w {} +
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
