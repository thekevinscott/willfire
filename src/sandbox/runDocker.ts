import { spawnCollect } from "../spawnCollect.js";

// The client itself runs with the host environment — it needs the host PATH
// and any DOCKER_HOST to find the daemon.
export async function runDocker(
  bin: string,
  argv: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const r = await spawnCollect(bin, argv, { env: process.env, stdin });
  // A client binary that never started is an unrunnable command, which is 127.
  return "failed" in r ? { code: 127, stdout: "", stderr: "" } : r;
}
