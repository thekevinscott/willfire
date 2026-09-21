import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scratch } from "./scratch.js";

/**
 * A step's `$GITHUB_OUTPUT`, bound into `env` after every layer is applied so
 * no `env:` block can redirect where outputs land. The directory is returned
 * for the caller to mount writable — a step writes its outputs there — and
 * `remove` for the caller to call once the outputs have been read back.
 */
export async function outputSink(
  env: Record<string, string>,
): Promise<{ dir: string; file: string; remove: () => Promise<void> }> {
  const { dir, remove } = await scratch("willfire-out-");
  const file = join(dir, "output");
  await writeFile(file, "");
  env.GITHUB_OUTPUT = file;
  return { dir, file, remove };
}
