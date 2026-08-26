import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { jobDisplayName } from "../names/jobDisplayName.js";
import { expandJobs } from "./expandJobs.js";
import { resolveCallee } from "./resolveCallee.js";
import type {
  Ctx,
  DetailedCombo,
  ExpandedJob,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

/**
 * Reusable workflow call. The calling job produces no check of its own; each
 * called job becomes `<calling job name> / <called job name>`, and a matrix on
 * the *caller* multiplies the whole callee set. A cross-repo call names its
 * checks exactly the same way a local one does — probe PR #9,
 * `call-remote-tag / r-inner` alongside `call-plain / inner`.
 */
export async function expandReusableCall(
  jobId: string,
  job: Workflow,
  combos: Array<DetailedCombo | null>,
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
  const { subWf, subSource, subScope, failure } = await resolveCallee(
    uses,
    job.with,
    source,
    reader,
    depth,
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
