import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scratch } from "./scratch.js";
import type { WorkflowSource } from "../types.js";
import type { ProvidedTree, RunCommand } from "./types.js";

export async function materialize(
  source: WorkflowSource,
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): Promise<ProvidedTree | null> {
  const bytes = await download(source);
  if (bytes === null) {
    return null;
  }
  const { dir, remove } = await scratch("willfire-tree-");
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
    // The bytes are attacker-chosen on a fork PR, so `tar` reads them inside
    // the sandbox. The scratch holds both the archive and the destination.
    mounts: [{ path: dir, writable: true }],
  });
  if (r.code !== 0) {
    await remove();
    return null;
  }
  const entries = await readdir(dest);
  if (entries.length === 1) {
    const sub = join(dest, entries[0]);
    if ((await stat(sub)).isDirectory()) {
      return { tree: sub, remove };
    }
  }
  return { tree: dest, remove };
}
