import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temp directory paired with the only thing that removes it. */
export interface Scratch {
  dir: string;
  remove: () => Promise<void>;
}

/**
 * Every temp directory willfire creates comes from here, so nothing outlives
 * the run that made it (GOALS.md 5). `force` keeps a second `remove` — a
 * failure path that already cleaned up — from throwing.
 */
export async function scratch(prefix: string): Promise<Scratch> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}
