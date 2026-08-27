import { describe, expect, it } from "vitest";
import { workflowCallInputs } from "./workflowCallInputs.js";

describe("workflowCallInputs", () => {
  it("returns the declared inputs block", () => {
    const inputs = { lang: { default: "ts" } };
    expect(workflowCallInputs({ on: { workflow_call: { inputs } } })).toBe(inputs);
  });

  it("tolerates the YAML 1.1 on -> true key", () => {
    const inputs = { lang: {} };
    expect(workflowCallInputs({ true: { workflow_call: { inputs } } })).toBe(inputs);
  });

  it("returns empty when any level is absent or not an object", () => {
    expect(workflowCallInputs({})).toEqual({});
    expect(workflowCallInputs({ on: "push" })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: null } })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: { inputs: "x" } } })).toEqual({});
  });
});
