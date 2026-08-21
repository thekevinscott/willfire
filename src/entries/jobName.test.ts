import { describe, expect, it } from "vitest";
import { jobName } from "./jobName.js";
import type { ExpandedJob, JobEntry, WorkflowEntry } from "../types.js";

// Compile-time only, checked by `tsc --noEmit` over this file rather than at
// run time. `expandJobs` is the sole producer of job entries, so the status a
// `JobEntry` can carry is exactly the status an `ExpandedJob` carries — and
// `no-dispatch`, a verdict about whether the run happens at all, belongs to
// the workflow level and nowhere else. Both drift silently without this.
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
