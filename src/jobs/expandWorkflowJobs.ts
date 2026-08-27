import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { expandJobs } from "./expandJobs.js";
import type { Ctx, ExpandedJob, Workflow, WorkflowReader, WorkflowSource } from "../types.js";

export function expandWorkflowJobs(
  wf: Workflow,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  scope: Scope = {},
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  return expandJobs(wf, ctx, reader, source, 0, "", true, scope, executor);
}
