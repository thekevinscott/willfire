import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { jobDisplayName } from "../names/jobDisplayName.js";
import { expandJobs } from "./expandJobs.js";
import { resolveReusable } from "./resolveReusable.js";
import type {
  Ctx,
  DetailedCombos,
  ExpandedJob,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

export async function expandUses(
  jobId: string,
  job: Workflow,
  combos: DetailedCombos,
  note: string,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  depth: number,
  prefix: string,
  prefixResolved: boolean,
  scoped: Scope,
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  const uses: string = job.uses;
  if (combos == null) {
    return [
      {
        job: prefix + jobId,
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix on reusable workflow call" + note,
      },
    ];
  }
  const { subWf, subSource, subScope, failure } = await resolveReusable(
    uses,
    job.with,
    depth,
    reader,
    source,
    scoped,
  );
  const entries: ExpandedJob[] = [];
  for (const combo of combos) {
    const disp = jobDisplayName(jobId, job, combo);
    const baseName = prefix + disp.name;
    const nameResolved = prefixResolved && disp.resolved;
    if (failure != null || subWf == null) {
      entries.push({
        job: baseName,
        checkName: null,
        status: "unknown",
        reason: failure ?? `cannot resolve ${uses}`,
      });
      continue;
    }
    entries.push(
      ...(await expandJobs(
        subWf,
        ctx,
        reader,
        subSource,
        depth + 1,
        `${baseName} / `,
        nameResolved,
        subScope,
        executor,
      )),
    );
  }
  return entries;
}
