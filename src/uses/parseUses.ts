import { EXPRESSION_RE } from "../names/jobDisplayName.js";
import type { UsesTarget } from "../types.js";

export function parseUses(uses: string): UsesTarget | null {
  if (EXPRESSION_RE.test(uses)) {
    return null;
  }
  if (uses.startsWith("./")) {
    const path = uses.slice(2);
    return path === "" ? null : { path, source: null };
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
  const path = rest.join("/");
  if (!owner || !repo || path === "") {
    return null;
  }
  return { path, source: { owner, repo, ref } };
}
