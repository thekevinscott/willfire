import type { ActionTarget } from "./types.js";

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
