import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/**
 * Does `path` stay inside `root` once symlinks are followed? A `..` segment in
 * a `uses:` or a symlink committed to the tree would otherwise aim a host-side
 * read at a file the repo does not contain. A path that does not resolve is
 * compared lexically: there is nothing there to read either way.
 */
export async function withinRoot(root: string, path: string): Promise<boolean> {
  const real = async (p: string): Promise<string> => await realpath(p).catch(() => resolve(p));
  const rel = relative(await real(root), await real(path));
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}
