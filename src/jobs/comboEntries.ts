import { jobDisplayName } from "../names/jobDisplayName.js";
import type { DetailedCombo, ExpandedJob, Workflow } from "../types.js";

/** One entry per matrix combination, named through the caller's prefix. */
export function comboEntries(
  jobId: string,
  job: Workflow,
  combos: Array<DetailedCombo | null>,
  prefix: string,
  prefixResolved: boolean,
  status: "run" | "skipped" | "unknown",
  reason: string,
): ExpandedJob[] {
  return combos.map((combo) => {
    const disp = jobDisplayName(jobId, job, combo);
    const name = prefix + disp.name;
    return {
      job: name,
      checkName: prefixResolved && disp.resolved ? name : null,
      status,
      reason,
    };
  });
}
