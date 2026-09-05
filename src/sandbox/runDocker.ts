import { spawn } from "node:child_process";

// The client itself runs with the host environment — it needs the host PATH
// and any DOCKER_HOST to find the daemon.
export function runDocker(
  bin: string,
  argv: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, argv, {
      env: process.env,
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d: Buffer) => {
      stdout = (stdout + String(d)).slice(-4096);
    });
    child.stderr!.on("data", (d: Buffer) => {
      stderr = (stderr + String(d)).slice(-4096);
    });
    child.on("spawn", () => {
      if (stdin !== undefined) {
        child.stdin!.write(stdin);
        child.stdin!.end();
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stdout, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}
