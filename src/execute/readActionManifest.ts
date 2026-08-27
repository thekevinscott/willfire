import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readActionManifest(dir: string): Promise<string | null> {
  for (const name of ["action.yml", "action.yaml"]) {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch {
      /* try the other spelling */
    }
  }
  return null;
}
