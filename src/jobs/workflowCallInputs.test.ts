import { describe, expect, it } from "vitest";
import { workflowCallInputs } from "./workflowCallInputs.js";
import type { Workflow } from "../types.js";

describe("workflowCallInputs", () => {
  it("reads on.workflow_call.inputs", () => {
    const wf = { on: { workflow_call: { inputs: { x: { default: 1 } } } } } as Workflow;
    expect(workflowCallInputs(wf)).toEqual({ x: { default: 1 } });
  });

  it("tolerates the YAML 1.1 true key", () => {
    const wf = { true: { workflow_call: { inputs: { x: {} } } } } as unknown as Workflow;
    expect(workflowCallInputs(wf)).toEqual({ x: {} });
  });

  it("returns nothing without a declared inputs block", () => {
    expect(workflowCallInputs(undefined as unknown as Workflow)).toEqual({});
    expect(workflowCallInputs({} as Workflow)).toEqual({});
    expect(workflowCallInputs({ on: "push" } as Workflow)).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: null } } as Workflow)).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: "x" } } as Workflow)).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: { inputs: null } } } as Workflow)).toEqual({});
  });
});
