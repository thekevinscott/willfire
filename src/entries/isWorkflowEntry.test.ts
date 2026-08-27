import { describe, expect, it } from "vitest";
import { isWorkflowEntry } from "./isWorkflowEntry.js";
import { jobName } from "./jobName.js";
import type { Entry } from "../types.js";

describe("isWorkflowEntry", () => {
  it("is true for the workflow-level sentinel job", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: "*",
      checkName: null,
      status: "no-dispatch",
      reason: "r",
    };
    expect(isWorkflowEntry(e)).toBe(true);
  });

  it("is false for a job entry", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: jobName("a"),
      checkName: "a",
      status: "run",
      reason: "",
    };
    expect(isWorkflowEntry(e)).toBe(false);
  });
});
