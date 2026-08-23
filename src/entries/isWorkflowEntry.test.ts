import { describe, expect, it } from "vitest";
import { isWorkflowEntry } from "./isWorkflowEntry.js";
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
    const e = {
      workflow: "w.yml",
      job: "a",
      checkName: "a",
      status: "run",
      reason: "",
    } as unknown as Entry;
    expect(isWorkflowEntry(e)).toBe(false);
  });
});
