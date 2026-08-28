import { describe, expect, it } from "vitest";
import { isJobEntry } from "./isJobEntry.js";
import type { Entry, JobName } from "../types.js";

describe("isJobEntry", () => {
  it("is true for a job entry", () => {
    const e: Entry = {
      workflow: "w.yml",
      job: "a" as JobName,
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
