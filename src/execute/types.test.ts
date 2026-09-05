import { describe, expectTypeOf, it } from "vitest";
import type { JobExecutor } from "./types.js";

describe("the JobExecutor contract", () => {
  it("takes job and workflow documents, not `any`", () => {
    expectTypeOf<JobExecutor["executeJob"]>().parameter(1).not.toBeAny();
    expectTypeOf<JobExecutor["executeJob"]>().parameter(2).not.toBeAny();
  });
});
