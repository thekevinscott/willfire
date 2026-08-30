import { capDisplayName } from "./capDisplayName.js";
import type { DisplayName, Workflow } from "../types.js";

/**
 * The check name a job gets when it is skipped.
 *
 * A skipped job is never set up, so nothing about it is evaluated: the matrix
 * does not expand and `name:` is not interpolated. Probe-verified twice over:
 * `if: false` with `a: [x, y]` produces the single check `m-skipped`, not
 * `m-skipped (x)` / `m-skipped (y)`; and `name: sk ${{ github.event_name }}`
 * with `if: false` produces a check literally called
 * `sk ${{ github.event_name }}`, expression text and all. The same collapse
 * applies to a skipped reusable-workflow call: one check named after the
 * caller, with no `/ <callee job>` entries.
 */
export function skippedDisplayName(jobId: string, job: Workflow): DisplayName {
  const raw = job.name !== undefined && job.name !== null ? String(job.name) : null;
  return { name: capDisplayName(raw ?? jobId), resolved: true };
}
