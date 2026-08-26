import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import type { Workflow } from "../types.js";
import { evalIf } from "./evalIf.js";
import { neededJobIds } from "./neededJobIds.js";

/**
 * Selection is derived, never configured: execute exactly the jobs some
 * sibling's `needs.*.outputs` read depends on, under the same `evalIf`
 * verdict the main loop applies.
 */
export async function executeNeeded(
  jobs: Record<string, Workflow>,
  wf: Workflow,
  scope: Scope,
  executor: JobExecutor,
): Promise<{ scoped: Scope; execFailures: Record<string, string> }> {
  let scoped = scope;
  const execFailures: Record<string, string> = {};
  const needed = neededJobIds(jobs);
  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    if (!needed.has(jobId)) {
      continue;
    }
    const job = jobRaw ?? {};
    // A reusable-call job has no steps of its own to run.
    if ("uses" in job) {
      continue;
    }
    if (evalIf(job.if, scoped) !== "run") {
      continue;
    }
    const res = await executor.executeJob(jobId, job, wf, scoped);
    if (res.ok) {
      scoped = { ...scoped, needs: { ...scoped.needs, [jobId]: { outputs: res.outputs } } };
    } else {
      execFailures[jobId] = res.reason;
    }
  }
  return { scoped, execFailures };
}
