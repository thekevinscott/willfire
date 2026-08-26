import type { SourceRef } from "../types.js";

/**
 * `owner/repo[/path]@ref` — unlike a reusable-workflow reference the path may
 * be empty, since an action commonly lives at the repo root.
 */
export function parseActionUses(uses: string): { path: string; source: SourceRef } | null {
  if (uses.includes("${{") || uses.startsWith("docker://")) return null;
  const at = uses.lastIndexOf("@");
  if (at <= 0) return null;
  const ref = uses.slice(at + 1);
  if (ref === "") return null;
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  if (!owner || !repo) return null;
  return { path: rest.join("/"), source: { owner, repo, ref } };
}
