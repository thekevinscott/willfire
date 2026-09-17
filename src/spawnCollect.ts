import { spawn } from "node:child_process";

// Only a tail is ever quoted back, so a runaway stream is truncated to one.
// Applied unconditionally: slicing a shorter string is a no-op.
const CAP = 4096;

export type Collected = { code: number; stdout: string; stderr: string } | { failed: string };

export type CollectOpts = {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  stdin?: string;
  /** For a caller that parses stdout whole, where the tail cap would corrupt it. */
  wholeStdout?: boolean;
};

/**
 * Spawn a child and collect both streams. Never rejects: a child that never
 * starts resolves as `failed`, which each caller reports in its own terms.
 */
export function spawnCollect(bin: string, argv: string[], opts: CollectOpts): Promise<Collected> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, argv, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d: Buffer) => {
      const next = stdout + String(d);
      stdout = opts.wholeStdout === true ? next : next.slice(-CAP);
    });
    child.stderr!.on("data", (d: Buffer) => {
      stderr = (stderr + String(d)).slice(-CAP);
    });
    child.on("spawn", () => {
      if (opts.stdin !== undefined) {
        child.stdin!.write(opts.stdin);
        child.stdin!.end();
      }
    });
    child.on("error", (e: Error) => resolvePromise({ failed: e.message }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}
