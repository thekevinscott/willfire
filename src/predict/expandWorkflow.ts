import { parse as parseYaml } from "yaml";
import { jobName } from "../entries/jobName.js";
import type { JobExecutor } from "../execute/types.js";
import type { Scope } from "../expr/val.js";
import { expandJobs } from "../jobs/expandJobs.js";
import { workflowDispatches } from "../triggers/workflowDispatches.js";
import type {
  Ctx,
  DraftEntry,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

export async function expandWorkflow(
  w: { path: string; state: string },
  ctx: Ctx,
  reader: WorkflowReader,
  headSource: WorkflowSource,
  prFacts: Scope,
  executor: JobExecutor | undefined,
): Promise<DraftEntry[]> {
  const path = w.path;
  if (!path.startsWith(".github/workflows/")) {
    return [];
  }
  if (w.state !== "active") {
    return [{ workflow: path, job: "*", status: "no-dispatch", reason: `workflow state: ${w.state}` }];
  }
  const content = await reader.fetchWorkflow(path, headSource);
  if (content == null) {
    return [{ workflow: path, job: "*", status: "no-dispatch", reason: "no workflow file at head" }];
  }
  let wf: Workflow;
  try {
    wf = parseYaml(content);
  } catch (e) {
    return [{ workflow: path, job: "*", status: "run", reason: `YAML parse error: ${e}` }];
  }
  const [dispatches, reason] = workflowDispatches(wf, ctx);
  if (!dispatches) {
    return [{ workflow: path, job: "*", status: "no-dispatch", reason }];
  }
  const entries: DraftEntry[] = [];
  for (const j of await expandJobs(wf, ctx, reader, headSource, 0, "", true, prFacts, executor)) {
    entries.push({
      workflow: path,
      job: jobName(j.job),
      checkName: j.checkName,
      status: j.status,
      reason: j.reason || reason,
    });
  }
  return entries;
}
