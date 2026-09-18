import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A step's `$GITHUB_OUTPUT`, bound into `env` after every layer is applied so
 * no `env:` block can redirect where outputs land. The directory is returned
 * for the caller to mount writable — a step writes its outputs there.
 */
export async function outputSink(
  env: Record<string, string>,
): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const file = join(dir, "output");
  await writeFile(file, "");
  env.GITHUB_OUTPUT = file;
  return { dir, file };
}
