import { spawn } from "node:child_process";

// The client itself runs with the host environment — it needs the host PATH
// and any DOCKER_HOST to find the daemon.
export function runDocker(
  bin: string,
  argv: string[],
  stdin?: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, argv, {
      env: process.env,
      stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr!.on("data", (d: Buffer) => {
      stderr += String(d);
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });
    child.on("spawn", () => {
      if (stdin !== undefined) {
        child.stdin!.write(stdin);
        child.stdin!.end();
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
}
