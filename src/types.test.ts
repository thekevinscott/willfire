import { describe, expectTypeOf, it } from "vitest";
import type { JobEntry, JobName, WorkflowEntry } from "./types.js";

// types.ts emits nothing, so these assertions are checked by `tsc`
// (pnpm typecheck covers tests) rather than at run time.
describe("Entry", () => {
  it("keeps `unknown` off the workflow-level variant", () => {
    expectTypeOf<WorkflowEntry["status"]>().toEqualTypeOf<
      "run" | "skipped" | "no-dispatch"
    >();
  });

  it("keeps the workflow-level sentinel out of JobEntry", () => {
    const sentinel = {
      workflow: "w",
      reason: "r",
      job: "*",
      checkName: null,
      status: "unknown",
    } as const;

    // @ts-expect-error the shape `JobName` exists to forbid. If widening ever
    // admits it, this directive goes unused and tsc fails on the directive.
    expectTypeOf(sentinel).toExtend<JobEntry>();
  });

  it("brands JobName so a bare string cannot stand in for one", () => {
    expectTypeOf<string>().not.toExtend<JobName>();
  });
});
