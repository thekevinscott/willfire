import type { ActionTarget } from "./types.js";

/**
 * `owner/repo[/path]@ref` — unlike a reusable-workflow reference the path may
 * be empty, since an action commonly lives at the repo root.
 */
export function parseActionUses(uses: string): ActionTarget | null {
  if (uses.includes("${{") || uses.startsWith("docker://")) {
    return null;
  }
  const at = uses.lastIndexOf("@");
  const ref = uses.slice(at + 1);
  // With no `@` at all, the slice from `at + 1` is the whole string again.
  if (ref === "" || ref === uses) {
    return null;
  }
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  if (!owner || !repo) {
    return null;
  }
  return { path: rest.join("/"), source: { owner, repo, ref } };
}
