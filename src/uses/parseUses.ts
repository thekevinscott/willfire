import { EXPRESSION_RE } from "../names/jobDisplayName.js";
import type { UsesTarget } from "../types.js";

/**
 * Split a job-level `uses:` into the file it names and the repo it lives in.
 *
 * Two spellings are legal:
 *
 *   `./.github/workflows/x.yml`              -> the caller's repo, same commit
 *   `owner/repo/.github/workflows/x.yml@ref` -> another repo, at `ref`
 *
 * The ref is taken from the last `@` so a branch containing a slash
 * (`@feature/foo`) survives. Returns null for anything else — including a
 * reference built from an expression, which we cannot evaluate and so must not
 * guess a fetch target for.
 */
export function parseUses(uses: string): UsesTarget | null {
  if (EXPRESSION_RE.test(uses)) return null;
  if (uses.startsWith("./")) {
    const path = uses.slice(2);
    return path === "" ? null : { path, source: null };
  }
  const at = uses.lastIndexOf("@");
  if (at <= 0) return null;
  const ref = uses.slice(at + 1);
  if (ref === "") return null;
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  const path = rest.join("/");
  if (!owner || !repo || path === "") return null;
  return { path, source: { owner, repo, ref } };
}
