import { describe, expect, it } from "vitest";
import { getPrTrigger, MISSING } from "./getPrTrigger.js";
import type { Workflow } from "../types.js";

describe("getPrTrigger", () => {
  it("is MISSING when there is no on key at all", () => {
    expect(getPrTrigger({} as Workflow)).toBe(MISSING);
  });

  it("is MISSING for an on that is an unusable scalar", () => {
    expect(getPrTrigger({ on: true } as Workflow)).toBe(MISSING);
  });

  it("reads the YAML 1.1 boolean-key spelling of on", () => {
    expect(getPrTrigger({ true: { pull_request: null } } as Workflow)).toEqual({});
  });

  it("accepts a string on naming pull_request", () => {
    expect(getPrTrigger({ on: "pull_request" } as Workflow)).toEqual({});
  });

  it("is MISSING for a string on naming another event", () => {
    expect(getPrTrigger({ on: "push" } as Workflow)).toBe(MISSING);
  });

  it("accepts a list on containing pull_request", () => {
    expect(getPrTrigger({ on: ["push", "pull_request"] } as Workflow)).toEqual({});
  });

  it("is MISSING for a list on without pull_request", () => {
    expect(getPrTrigger({ on: ["push"] } as Workflow)).toBe(MISSING);
  });

  it("is MISSING for a map on without pull_request", () => {
    expect(getPrTrigger({ on: { push: null } } as Workflow)).toBe(MISSING);
  });

  it("hands back the trigger's own map when it has one", () => {
    const trig = { types: ["labeled"] };
    expect(getPrTrigger({ on: { pull_request: trig } } as Workflow)).toBe(trig);
  });
});
