import { parse as parseYaml } from "yaml";
import { jobName } from "../entries/jobName.js";
import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { expandJobs } from "../jobs/expandJobs.js";
import { workflowDispatches } from "../triggers/workflowDispatches.js";
import type {
  Ctx,
  DraftEntry,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

/** The draft entries one listed workflow contributes to the prediction. */
export async function workflowEntries(
  w: { path: string; state: string },
  ctx: Ctx,
  reader: WorkflowReader,
  headSource: WorkflowSource,
  prFacts: Scope,
  executor?: JobExecutor,
): Promise<DraftEntry[]> {
  const path = w.path;
  if (w.state !== "active") {
    return [
      { workflow: path, job: "*", status: "no-dispatch", reason: `workflow state: ${w.state}` },
    ];
  }
  const content = await reader.fetchWorkflow(path, headSource);
  if (content == null) {
    // The Actions API keeps listing a workflow as `active` after its file is
    // deleted. There is no file at head, so there is nothing to dispatch —
    // the same verdict as the disabled case above, reached a different way.
    return [
      { workflow: path, job: "*", status: "no-dispatch", reason: "no workflow file at head" },
    ];
  }
  let wf: Workflow;
  try {
    wf = parseYaml(content);
  } catch (e) {
    // GitHub creates a run for an unparseable workflow file and concludes it
    // `startup_failure`. The run exists but has no jobs, so this is a
    // workflow-level "it dispatches" with nothing to expand.
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
