import { describe, expect, it } from "vitest";
import { calleeInputs } from "./calleeInputs.js";
import type { Workflow } from "../types.js";

const wfWith = (inputs: unknown): Workflow =>
  ({ on: { workflow_call: { inputs } } }) as Workflow;

describe("calleeInputs", () => {
  it("takes the declared default when the caller omits an input", () => {
    expect(calleeInputs(undefined, wfWith({ x: { default: "d" } }))).toEqual({
      x: { kind: "value", v: "d" },
    });
  });

  it("prefers the caller's value over the default", () => {
    expect(calleeInputs({ x: "c" }, wfWith({ x: { default: "d" } }))).toEqual({
      x: { kind: "value", v: "c" },
    });
  });

  it("leaves a declared input with no default unknown", () => {
    expect(calleeInputs(undefined, wfWith({ x: {} }))).toEqual({ x: { kind: "unknown" } });
    expect(calleeInputs(undefined, wfWith({ x: null }))).toEqual({ x: { kind: "unknown" } });
  });

  it("accepts caller values the callee never declared", () => {
    expect(calleeInputs({ y: 2 }, {} as Workflow)).toEqual({ y: { kind: "value", v: 2 } });
  });
});
