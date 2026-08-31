import { describe, expect, expectTypeOf, it } from "vitest";
import { absentInputs } from "./absentInputs.js";
import type { Workflow } from "../types.js";

/** What an input reads as when nothing supplied it. */
const EMPTY = { kind: "value", v: "" };

describe("absentInputs", () => {
  it("binds every declared workflow_dispatch input to the empty string", () => {
    expect(
      absentInputs({
        on: { pull_request: null, workflow_dispatch: { inputs: { version: { type: "string" } } } },
      } as Workflow),
    ).toEqual({ version: EMPTY });
  });

  it("ignores a declared default, which only a dispatch would apply", () => {
    expect(
      absentInputs({
        on: { workflow_dispatch: { inputs: { level: { type: "string", default: "high" } } } },
      } as Workflow),
    ).toEqual({ level: EMPTY });
  });

  it("covers workflow_call inputs too, for a workflow that is also callable", () => {
    expect(
      absentInputs({
        on: {
          workflow_dispatch: { inputs: { a: null } },
          workflow_call: { inputs: { b: null } },
        },
      } as Workflow),
    ).toEqual({ a: EMPTY, b: EMPTY });
  });

  it("reads the YAML 1.1 `on` -> true key", () => {
    expect(
      absentInputs({ true: { workflow_dispatch: { inputs: { v: null } } } } as Workflow),
    ).toEqual({ v: EMPTY });
  });

  it("reads the trigger block off a document, not off `any`", () => {
    const wf: Workflow = { on: { workflow_dispatch: { inputs: { v: null } } } };
    expectTypeOf(wf["on"]).not.toBeAny();
    expect(absentInputs(wf)).toEqual({ v: EMPTY });
  });

  it("says nothing for a workflow that declares no inputs", () => {
    expect(absentInputs({ on: ["workflow_dispatch"] } as Workflow)).toEqual({});
    expect(absentInputs({ on: { pull_request: null } } as Workflow)).toEqual({});
    expect(absentInputs({ on: { workflow_dispatch: null } } as Workflow)).toEqual({});
    expect(absentInputs({ on: { workflow_dispatch: { inputs: null } } } as Workflow)).toEqual({});
    expect(absentInputs({ on: "pull_request" } as Workflow)).toEqual({});
    expect(absentInputs({} as Workflow)).toEqual({});
  });
});
