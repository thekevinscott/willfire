import type { ExecutionGrant } from "./types.js";

/** `owner/repo:job1,job2` as the CLI spells a grant. */
export function parseGrant(spec: string): ExecutionGrant | null {
  const colon = spec.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  const repo = spec.slice(0, colon);
  const parts = repo.split("/");
  if (parts.length !== 2 || parts.some((p) => p === "")) {
    return null;
  }
  const jobs = spec
    .slice(colon + 1)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (jobs.length === 0) {
    return null;
  }
  return { repo, jobs };
}
