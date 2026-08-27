import { createHash } from "node:crypto";

export function imageTag(dockerfile: string): string {
  const hash = createHash("sha256").update(dockerfile).digest("hex");
  return `willfire-sandbox:${hash.slice(0, 12)}`;
}
