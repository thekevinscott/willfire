import { describe, expect, it } from "vitest";
import { jobName } from "./jobName.js";
import type { ExpandedJob, JobEntry, WorkflowEntry } from "../types.js";

// Compile-time only, checked by `tsc --noEmit`. `expandJobs` is the sole
// producer of job entries, so their statuses must match exactly, and
// `no-dispatch` is workflow-level. Both drift silently without this.
type Assert<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type _JobStatusIsWhatExpansionProduces = Assert<
  Eq<JobEntry["status"], ExpandedJob["status"]>
>;
type _JobStatusExcludesNoDispatch = Assert<
  Eq<Extract<JobEntry["status"], "no-dispatch">, never>
>;
type _NoDispatchLivesOnTheWorkflow = Assert<
  Eq<Extract<WorkflowEntry["status"], "no-dispatch">, "no-dispatch">
>;

describe("jobName", () => {
  it("brands a job name without changing the string", () => {
    expect(jobName("build")).toBe("build");
  });
});
