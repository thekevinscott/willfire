import { describe, expect, it } from "vitest";
import { getPrTrigger, MISSING } from "./getPrTrigger.js";
import type { Workflow } from "../types.js";

describe("getPrTrigger", () => {
  it("is MISSING when there is no on key at all", () => {
    expect(getPrTrigger({} as Workflow)).toBe(MISSING);
  });

  it("is MISSING for an on that is an unusable scalar", () => {
    // `on: true` — YAML 1.2 keeps the key a string and the value a boolean, so
    // there is no trigger map to read.
    expect(getPrTrigger({ on: true } as Workflow)).toBe(MISSING);
  });

  it("reads the YAML 1.1 boolean-key spelling of on", () => {
    // A parser that folds `on:` to boolean `true` leaves the trigger under the
    // key `true`. The fallback keeps such a file readable.
    expect(getPrTrigger({ true: { pull_request: null } } as Workflow)).toEqual({});
  });

  it("prefers the on key over the boolean-key spelling when both exist", () => {
    expect(
      getPrTrigger({ on: { pull_request: null }, true: { push: null } } as Workflow),
    ).toEqual({});
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
