import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { evalIf } from "./evalIf.js";
import type { Workflow, WorkflowSource } from "../types.js";

export async function executeGranted(
  jobs: Record<string, Workflow>,
  wf: Workflow,
  scope: Scope,
  source: WorkflowSource,
  executor: JobExecutor | undefined,
): Promise<{ scoped: Scope; failures: Record<string, string> }> {
  let scoped = scope;
  const failures: Record<string, string> = {};
  if (executor == null) {
    return { scoped, failures };
  }
  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    if (!executor.granted(source, jobId)) {
      continue;
    }
    const job = jobRaw ?? {};
    if (evalIf(job.if, scoped) !== "run") {
      continue;
    }
    const res = await executor.executeJob(jobId, job, wf, scoped);
    if (res.ok) {
      scoped = { ...scoped, needs: { ...scoped.needs, [jobId]: { outputs: res.outputs } } };
    } else {
      failures[jobId] = res.reason;
    }
  }
  return { scoped, failures };
}
