import { createHash } from "node:crypto";

/** The tag names the dockerfile that built it, so a change is a new image. */
export function imageTag(dockerfile: string): string {
  const hash = createHash("sha256").update(dockerfile).digest("hex");
  return `willfire-sandbox:${hash.slice(0, 12)}`;
}
