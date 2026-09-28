import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scratch } from "./scratch.js";

/**
 * A step's `$GITHUB_OUTPUT` and `$GITHUB_ENV`, bound into `env` after every
 * layer is applied so no `env:` block can redirect where they land. The
 * directory is returned for the caller to mount writable — the step writes
 * both files — and `remove` for the caller to call once both are read back.
 */
export async function stepSinks(env: Record<string, string>): Promise<{
  dir: string;
  outputFile: string;
  envFile: string;
  remove: () => Promise<void>;
}> {
  const { dir, remove } = await scratch("willfire-out-");
  const outputFile = join(dir, "output");
  const envFile = join(dir, "env");
  await writeFile(outputFile, "");
  await writeFile(envFile, "");
  env.GITHUB_OUTPUT = outputFile;
  env.GITHUB_ENV = envFile;
  return { dir, outputFile, envFile, remove };
}
