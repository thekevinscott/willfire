import { describe, expect, it } from "vitest";
import { isJobEntry } from "./isJobEntry.js";
import type { Entry } from "../types.js";

describe("isJobEntry", () => {
  it("is true for a job entry", () => {
    const e = {
      workflow: "w.yml",
      job: "a",
      checkName: "a",
      status: "run",
      reason: "",
    } as unknown as Entry;
    expect(isJobEntry(e)).toBe(true);
    expect(isJobEntry({ ...e, job: "a (linux)" } as unknown as Entry)).toBe(true);
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
