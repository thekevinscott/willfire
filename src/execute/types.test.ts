import { describe, expectTypeOf, it } from "vitest";
import type { SourceRef, Workflow } from "../types.js";
import type { ActionTarget, JobExecutor } from "./types.js";

describe("the JobExecutor contract", () => {
  it("takes job and workflow documents, not `any`", () => {
    expectTypeOf<JobExecutor["executeJob"]>().parameter(1).not.toBeAny();
    expectTypeOf<JobExecutor["executeJob"]>().parameter(2).not.toBeAny();
  });

  it("admits the null workflow document an empty file parses to", () => {
    expectTypeOf<JobExecutor["executeJob"]>().parameter(2).toEqualTypeOf<Workflow | null>();
  });
});

describe("the ActionTarget shape", () => {
  it("points at a repo as a SourceRef, with a path inside it", () => {
    expectTypeOf<ActionTarget["source"]>().toEqualTypeOf<SourceRef>();
    expectTypeOf<ActionTarget["path"]>().toBeString();
  });
});
