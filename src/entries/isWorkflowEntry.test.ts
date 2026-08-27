import { describe, expect, it } from "vitest";
import { isWorkflowEntry } from "./isWorkflowEntry.js";
import type { Entry, JobName } from "../types.js";

// Branded by hand: importing jobName() would be an unmocked collaborator.
const plain: string = "a";

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
      job: plain as JobName,
      checkName: "a",
      status: "run",
      reason: "",
    };
    expect(isWorkflowEntry(e)).toBe(false);
  });
});
