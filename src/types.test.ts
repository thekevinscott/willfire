import { describe, expect, expectTypeOf, it } from "vitest";
import type { DetailedCombo, PredictOptions, Workflow } from "./types.js";

describe("the document types", () => {
  it("yields a document value on a read, not `any`", () => {
    const wf: Workflow = { on: { pull_request: null } };
    expectTypeOf(wf["on"]).not.toBeAny();
    expect(wf["on"]).toEqual({ pull_request: null });
  });

  it("carries a matrix combination as document values, not `any`", () => {
    const combo: DetailedCombo = { values: { os: "linux" }, displayKeys: ["os"] };
    expectTypeOf(combo.values["os"]).not.toBeAny();
    expect(combo.values["os"]).toBe("linux");
  });

  it("takes callback commands as an immutable list, so a caller's array is safe to hand over", () => {
    const commands = ["npx resolver"] as const;
    const opts: PredictOptions = { callbacks: commands };
    expectTypeOf(opts.callbacks).toEqualTypeOf<readonly string[] | undefined>();
    expect(opts.callbacks).toEqual(["npx resolver"]);
  });

  it("carries the executor seam as the JobExecutor contract, not `any`", () => {
    // Compiling this is the assertion: an executor whose `executeJob` takes
    // the wrong arity or returns the wrong shape would not assign here.
    const opts: PredictOptions = {
      executor: { executeJob: async () => ({ ok: false, reason: "r" }) },
    };
    expectTypeOf<NonNullable<PredictOptions["executor"]>["executeJob"]>().not.toBeAny();
    expect(typeof opts.executor?.executeJob).toBe("function");
  });
});
