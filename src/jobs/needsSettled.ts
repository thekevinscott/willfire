import type { Scope } from "../expr/val.js";

/**
 * How the jobs a job `needs` settled, for `success()` and `failure()` to read.
 * A job with no needs settles vacuously as `"all-run"`: `success()` there is
 * true — job `c` on probe PR #376, run 36430193559.
 */
export function needsSettled(
  needs: string[],
  statuses: Record<string, string>,
): Scope["needsSettled"] {
  if (needs.some((n) => statuses[n] === "unknown")) {
    return undefined;
  }
  return needs.some((n) => statuses[n] === "skipped") ? "some-skipped" : "all-run";
}
