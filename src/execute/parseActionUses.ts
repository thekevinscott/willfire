import type { ActionTarget } from "./types.js";

/**
 * A step-level `uses:` naming another repo: `owner/repo[/path]@ref`. Unlike a
 * reusable-workflow reference the path may be empty — an action commonly
 * lives at the repo root. Expressions and `docker://` images return null.
 */
export function parseActionUses(uses: string): ActionTarget | null {
  if (uses.includes("${{") || uses.startsWith("docker://")) {
    return null;
  }
  const at = uses.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const ref = uses.slice(at + 1);
  if (ref === "") {
    return null;
  }
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  if (!owner || !repo) {
    return null;
  }
  return { path: rest.join("/"), source: { owner, repo, ref } };
}
