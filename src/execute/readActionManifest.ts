import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Read `action.yml` (or `.yaml`) from a directory, or null if neither exists. */
export async function readActionManifest(dir: string): Promise<string | null> {
  for (const name of ["action.yml", "action.yaml"]) {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch {
      // fall through to the next spelling
    }
  }
  return null;
}
