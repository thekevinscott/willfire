import type { Scope } from "../expr/val.js";
import type { Workflow } from "../types.js";
import { evalIf } from "./evalIf.js";

/** A job's settled verdict, plus the `needs:` ids it was derived from. */
export interface JobVerdict {
  status: "run" | "skipped" | "unknown";
  reason: string;
  needs: string[];
}

const STATUS_FN_RE = /\b(?:success|failure|cancelled|always)\s*\(/i;

/**
 * Settle every job's status against its `needs:`, in dependency order.
 *
 * GitHub imposes no declaration order on `needs:`: a job declared before the
 * one it needs is skipped just the same (probe PR #373, run 36430122487, where
 * `needs-first` and `caller-first` collapsed to one skipped check each). A
 * single pass over the jobs map would read an unpopulated status and call the
 * dependent `run`.
 */
export function resolveStatuses(
  jobs: Record<string, Workflow>,
  scoped: Scope,
): Record<string, JobVerdict> {
  const verdicts: Record<string, JobVerdict> = {};
  const resolving = new Set<string>();

  const decide = (jobId: string): JobVerdict => {
    const job = jobs[jobId] ?? {};
    const needsRaw = job["needs"];
    const needs: string[] =
      typeof needsRaw === "string" ? [needsRaw] : ((needsRaw ?? []) as string[]);
    // A `needs:` naming a job the workflow does not declare fails it at
    // startup: no run attaches to the pull request and there is no check name
    // to predict (probe PR #374, run 36430154587).
    const dangling = needs.find((n) => !(n in jobs));
    if (dangling !== undefined) {
      return {
        status: "unknown",
        reason: `needs '${dangling}', which the workflow does not declare`,
        needs,
      };
    }
    const upstream = needs.map((n) => resolve(n).status);
    const cond = String(job.if ?? "");
    // Every need settled and one was skipped: a status-function condition is
    // decidable against that state (probe PR #341, run 36416679059), where a
    // condition without one falls to the implicit success() gate below. The
    // pattern is inline because the mutation gate covers no module-level
    // initializer.
    const settledSkip =
      upstream.some((s) => s === "skipped") &&
      upstream.every((s) => s !== "unknown") &&
      STATUS_FN_RE.test(cond);
    let status = evalIf(job.if, settledSkip ? { ...scoped, skippedNeed: true } : scoped);
    let reason = job.if !== undefined && job.if !== null ? `if: ${JSON.stringify(job.if)}` : "";
    if (!settledSkip && status !== "skipped" && !cond.includes("always()")) {
      needs.forEach((n, i) => {
        if (upstream[i] === "skipped") {
          status = "skipped";
          reason = `needs '${n}' which is skipped`;
        } else if (upstream[i] === "unknown" && status === "run") {
          status = "unknown";
          reason = `needs '${n}' whose status is unknown`;
        }
      });
    }
    return { status, reason, needs };
  };

  const resolve = (jobId: string): JobVerdict => {
    const settled = verdicts[jobId];
    if (settled !== undefined) {
      return settled;
    }
    // A `needs:` cycle fails the workflow at startup the same way a dangling
    // one does, so re-entry answers unknown rather than recursing forever.
    // Left unmemoised: the outer frame still has to settle its own verdict.
    if (resolving.has(jobId)) {
      return { status: "unknown", reason: `needs '${jobId}' forms a cycle`, needs: [] };
    }
    resolving.add(jobId);
    const verdict = decide(jobId);
    resolving.delete(jobId);
    verdicts[jobId] = verdict;
    return verdict;
  };

  for (const jobId of Object.keys(jobs)) {
    resolve(jobId);
  }
  return verdicts;
}
