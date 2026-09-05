import type { Scope } from "../expr/val.js";
import type { JobExecutor } from "../execute/types.js";
import { expandJobs } from "./expandJobs.js";
import type { Ctx, ExpandedJob, Workflow, WorkflowReader, WorkflowSource } from "../types.js";

/**
 * Expand one already-parsed workflow into its job entries. Exported so check
 * names can be tested against recorded GitHub behaviour without a network
 * round-trip; `predict` is the API you want.
 *
 * `scope` seeds what this workflow's own `${{ }}` resolve against — notably
 * `needs`, the outputs of jobs that have not run. Nothing here works out what
 * those are; a caller that knows hands them in, and a caller that does not
 * leaves them out and gets `unknown` where they would have been used.
 */
export function expandWorkflowJobs(
  wf: Workflow,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  scope: Scope = {},
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  // This seam's callers hand in an already-parsed document, not a file, so
  // there is no path to name; `predict`, which reads real files, supplies one.
  return expandJobs({ wf, ctx, reader, site: { path: "", source }, scope, executor });
}
