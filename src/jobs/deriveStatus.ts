import type { Scope } from "../expr/val.js";
import type { Workflow } from "../types.js";
import { evalIf } from "./evalIf.js";

export interface DerivedStatus {
  status: "run" | "skipped" | "unknown";
  reason: string;
  needs: string[];
}

/**
 * A job's own `if:` verdict, then its `needs:` chain: a skipped upstream skips
 * it, an unknown upstream makes a would-run job unknown — unless the condition
 * carries `always()`, which cuts the chain.
 */
export function deriveStatus(
  job: Workflow,
  scoped: Scope,
  statuses: Record<string, string>,
): DerivedStatus {
  let status = evalIf(job.if, scoped);
  let reason = job.if != null ? `if: ${JSON.stringify(job.if)}` : "";
  let needs: string[] = job.needs ?? [];
  if (typeof needs === "string") {
    needs = [needs];
  }
  const cond = String(job.if ?? "");
  if (status !== "skipped" && !cond.includes("always()")) {
    for (const n of needs) {
      if (statuses[n] === "skipped") {
        status = "skipped";
        reason = `needs '${n}' which is skipped`;
      } else if (statuses[n] === "unknown" && status === "run") {
        status = "unknown";
        reason = `needs '${n}' whose status is unknown`;
      }
    }
  }
  return { status, reason, needs };
}
