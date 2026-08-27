import { describe, expect, it } from "vitest";
import { isJobEntry } from "./isJobEntry.js";
import type { Entry, JobName } from "../types.js";

// Branded by hand: importing jobName() would be an unmocked collaborator.
const plain: string = "a";

describe("isJobEntry", () => {
  it("is true for a job entry", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: plain as JobName,
      checkName: "a",
      status: "run",
      reason: "",
    };
    expect(isJobEntry(e)).toBe(true);
  });

  it("is false for the workflow-level sentinel job", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: "*",
      checkName: null,
      status: "no-dispatch",
      reason: "r",
    };
    expect(isJobEntry(e)).toBe(false);
  });
});
