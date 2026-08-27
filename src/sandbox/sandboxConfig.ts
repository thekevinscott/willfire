export const SANDBOX_NODE_MAJOR = 24;

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
