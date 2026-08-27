import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { expandMatrixDetailed } from "../matrix/expandMatrixDetailed.js";
import { jobDisplayName } from "../names/jobDisplayName.js";
import { skippedDisplayName } from "../names/skippedDisplayName.js";
import { executeGranted } from "./executeGranted.js";
import { expandUses } from "./expandUses.js";
import { jobVerdict } from "./jobVerdict.js";
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

  const { scoped, failures } = await executeGranted(jobs, wf, scope, source, executor);
  const execNote = (needs: string[]): string => {
    const failed = needs.find((n) => n in failures);
    return failed == null ? "" : `; executing '${failed}' failed: ${failures[failed]}`;
  };

  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    const { status, reason, needs } = jobVerdict(job, scoped, statuses);
    statuses[jobId] = status;

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

    if ("uses" in job) {
      entries.push(
        ...(await expandUses(
          jobId,
          job,
          combos,
          execNote(needs),
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

    if (combos == null) {
      entries.push({
        job: prefix + jobId,
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix" + execNote(needs),
      });
      continue;
    }
    for (const combo of combos) {
      const disp = jobDisplayName(jobId, job, combo);
      const name = prefix + disp.name;
      entries.push({
        job: name,
        checkName: prefixResolved && disp.resolved ? name : null,
        status,
        reason,
      });
    }
  }
  return entries;
}
