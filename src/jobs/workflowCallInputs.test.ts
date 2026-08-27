import { describe, expect, expectTypeOf, it } from "vitest";
import { workflowCallInputs } from "./workflowCallInputs.js";

describe("workflowCallInputs", () => {
  it("returns the declared inputs block", () => {
    const inputs = { lang: { default: "ts" } };
    expect(workflowCallInputs({ on: { workflow_call: { inputs } } })).toBe(inputs);
  });

  it("returns a document map, so a read off it is not `any`", () => {
    const block = workflowCallInputs({ on: { workflow_call: { inputs: { lang: {} } } } });
    expectTypeOf(block["lang"]).not.toBeAny();
  });

  it("tolerates the YAML 1.1 on -> true key", () => {
    const inputs = { lang: {} };
    expect(workflowCallInputs({ true: { workflow_call: { inputs } } })).toBe(inputs);
  });

  it("returns empty for a workflow that is not there at all", () => {
    expect(workflowCallInputs(undefined as never)).toEqual({});
  });

  it("returns empty when any level is absent, null, or not an object", () => {
    expect(workflowCallInputs({})).toEqual({});
    // A bare `on:` line: the value parses null under the YAML 1.1 key.
    expect(workflowCallInputs({ true: null })).toEqual({});
    expect(workflowCallInputs({ on: "push" })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: null } })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: { inputs: null } } })).toEqual({});
    expect(workflowCallInputs({ on: { workflow_call: { inputs: "x" } } })).toEqual({});
  });
});
