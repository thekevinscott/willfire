import { describe, expect, it } from "vitest";
import { jobVerdict } from "./jobVerdict.js";
import type { Workflow } from "../types.js";

describe("jobVerdict", () => {
  it("runs a job with no if and no needs", () => {
    expect(jobVerdict({} as Workflow, {}, {})).toEqual({ status: "run", reason: "", needs: [] });
  });

  it("records the if expression as the reason", () => {
    expect(jobVerdict({ if: false } as Workflow, {}, {})).toEqual({
      status: "skipped",
      reason: "if: false",
      needs: [],
    });
  });

  it("normalizes a scalar needs", () => {
    expect(jobVerdict({ needs: "a" } as Workflow, {}, { a: "run" })).toEqual({
      status: "run",
      reason: "",
      needs: ["a"],
    });
  });

  it("skips a job that needs a skipped job", () => {
    expect(jobVerdict({ needs: ["a"] } as Workflow, {}, { a: "skipped" })).toEqual({
      status: "skipped",
      reason: "needs 'a' which is skipped",
      needs: ["a"],
    });
  });

  it("turns a would-run job unknown on an unknown need", () => {
    expect(jobVerdict({ needs: ["a"] } as Workflow, {}, { a: "unknown" })).toEqual({
      status: "unknown",
      reason: "needs 'a' whose status is unknown",
      needs: ["a"],
    });
  });

  it("keeps an already-unknown job's own reason past an unknown need", () => {
    const job = { if: "github.ref == 'x'", needs: ["a"] } as Workflow;
    expect(jobVerdict(job, {}, { a: "unknown" })).toEqual({
      status: "unknown",
      reason: `if: "github.ref == 'x'"`,
      needs: ["a"],
    });
  });

  it("reads past needs through always()", () => {
    expect(jobVerdict({ if: "always()", needs: ["a"] } as Workflow, {}, { a: "skipped" })).toEqual({
      status: "run",
      reason: `if: "always()"`,
      needs: ["a"],
    });
  });

  it("leaves a skipped job skipped without consulting needs", () => {
    expect(jobVerdict({ if: false, needs: ["a"] } as Workflow, {}, { a: "unknown" })).toEqual({
      status: "skipped",
      reason: "if: false",
      needs: ["a"],
    });
  });
});
