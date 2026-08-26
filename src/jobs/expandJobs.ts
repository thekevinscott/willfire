import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { expandMatrixDetailed } from "../matrix/expandMatrixDetailed.js";
import { skippedDisplayName } from "../names/skippedDisplayName.js";
import { comboEntries } from "./comboEntries.js";
import { deriveStatus } from "./deriveStatus.js";
import { executeNeeded } from "./executeNeeded.js";
import { expandReusableCall } from "./expandReusableCall.js";
import { prScope } from "./prScope.js";
import type {
  Ctx,
  ExpandedJob,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

export async function expandJobs(
  wf: Workflow,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  depth = 0,
  prefix = "",
  prefixResolved = true,
  scope: Scope = {},
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  const entries: ExpandedJob[] = [];
  const jobs: Record<string, Workflow> = wf.jobs ?? {};
  const statuses: Record<string, string> = {};

  let scoped = scope;
  let execFailures: Record<string, string> = {};
  if (executor != null) {
    ({ scoped, execFailures } = await executeNeeded(jobs, wf, scope, executor));
  }
  const execNote = (needs: string[]): string => {
    const failed = needs.find((n) => n in execFailures);
    return failed == null ? "" : `; executing '${failed}' failed: ${execFailures[failed]}`;
  };

  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    const { status, reason, needs } = deriveStatus(job, scoped, statuses);
    statuses[jobId] = status;

    // A skipped job never expands its matrix and never dispatches a called
    // workflow: it collapses to a single check under the bare job name.
    if (status === "skipped") {
      const disp = skippedDisplayName(jobId, job);
      const name = prefix + disp.name;
      entries.push({
        job: name,
        checkName: prefixResolved && disp.resolved ? name : null,
        status,
        reason,
      });
      continue;
    }

    const combos = expandMatrixDetailed(job.strategy, prScope(scoped));
    const isCall = "uses" in job;
    if (combos == null) {
      entries.push({
        job: prefix + jobId,
        checkName: null,
        status: "unknown",
        reason:
          (isCall ? "dynamic matrix on reusable workflow call" : "dynamic matrix") +
          execNote(needs),
      });
      continue;
    }
    if (isCall) {
      entries.push(
        ...(await expandReusableCall(
          jobId,
          job,
          combos,
          ctx,
          reader,
          source,
          depth,
          prefix,
          prefixResolved,
          scoped,
          executor,
        )),
      );
      continue;
    }
    entries.push(...comboEntries(jobId, job, combos, prefix, prefixResolved, status, reason));
  }
  return entries;
}
