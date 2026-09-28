import { describe, expect, it } from "vitest";
import { readsVars } from "./readsVars.js";
import type { Workflow } from "../types.js";

const jobs = (v: unknown): Record<string, Workflow> => v as Record<string, Workflow>;

describe("readsVars", () => {
  it("sees a bare `vars.` read in a job guard", () => {
    expect(readsVars(jobs({ a: { if: "vars.RUN_EXTRA == 'true'" } }))).toBe(true);
  });

  it("sees an index read and a templated read", () => {
    expect(readsVars(jobs({ a: { if: "vars['RUN_EXTRA']" } }))).toBe(true);
    expect(readsVars(jobs({ a: { strategy: { matrix: "${{ vars.M }}" } } }))).toBe(true);
  });

  it("does not fire on jobs that never mention the context", () => {
    expect(readsVars(jobs({ a: { if: "github.event_name == 'push'" } }))).toBe(false);
    expect(readsVars(jobs({}))).toBe(false);
  });

  it("does not fire on a name that merely ends in vars", () => {
    expect(readsVars(jobs({ a: { if: "inputs.myvars.x" } }))).toBe(false);
  });
});
