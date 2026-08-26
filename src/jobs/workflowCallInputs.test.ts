import { describe, expect, it } from "vitest";
import { workflowCallInputs } from "./workflowCallInputs.js";

describe("workflowCallInputs", () => {
  it("reads the declared inputs block", () => {
    const wf = { on: { workflow_call: { inputs: { a: { default: "x" } } } } };
    expect(workflowCallInputs(wf)).toEqual({ a: { default: "x" } });
  });

  it("tolerates YAML 1.1 parsing `on:` as a boolean key", () => {
    const wf = { true: { workflow_call: { inputs: { a: {} } } } };
    expect(workflowCallInputs(wf)).toEqual({ a: {} });
  });

  it("treats a malformed or absent block as no declared inputs", () => {
    expect(workflowCallInputs({})).toEqual({});
    expect(workflowCallInputs({ on: "push" })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: null } })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: "yes" } })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: { inputs: 5 } } })).toEqual({});
  });
});
