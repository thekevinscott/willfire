import { describe, expect, it } from "vitest";
import { isJobEntry } from "./isJobEntry.js";
import { jobName } from "./jobName.js";
import type { Entry } from "../types.js";

describe("isJobEntry", () => {
  it("is true for a job entry", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: jobName("a"),
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
