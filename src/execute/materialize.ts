import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowSource } from "../types.js";
import type { RunCommand } from "./types.js";

export async function materialize(
  source: WorkflowSource,
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): Promise<string | null> {
  const bytes = await download(source);
  if (bytes === null) {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), "willfire-tree-"));
  const archive = join(dir, "tree.tar.gz");
  await writeFile(archive, bytes);
  const dest = join(dir, "tree");
  await mkdir(dest);
  const r = await runCommand({
    script: 'tar -xzf "$WILLFIRE_ARCHIVE" -C "$WILLFIRE_DEST"',
    shell: "bash",
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      WILLFIRE_ARCHIVE: archive,
      WILLFIRE_DEST: dest,
    },
  });
  if (r.code !== 0) {
    return null;
  }
  const entries = await readdir(dest);
  if (entries.length === 1) {
    const sub = join(dest, entries[0]);
    if ((await stat(sub)).isDirectory()) {
      return sub;
    }
  }
  return dest;
}
