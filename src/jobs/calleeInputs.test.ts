import { describe, expect, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { calleeInputs } from "./calleeInputs.js";

const declaring = (inputs: unknown) => ({ on: { workflow_call: { inputs } } });

describe("calleeInputs", () => {
  it("falls back to a declared default the caller omitted", () => {
    expect(calleeInputs(undefined, declaring({ e: { default: "dflt" } }), {})).toEqual({
      e: { kind: "value", v: "dflt" },
    });
  });

  it("leaves a declared input with no default and no caller value unknown", () => {
    expect(calleeInputs(undefined, declaring({ f: { type: "string" } }), {})).toEqual({
      f: { kind: "unknown" },
    });
  });

  it("treats a malformed declaration as having no default", () => {
    expect(calleeInputs(undefined, declaring({ g: null, h: "string" }), {})).toEqual({
      g: { kind: "unknown" },
      h: { kind: "unknown" },
    });
  });

  it("lets what the caller passed win over the default", () => {
    expect(calleeInputs({ e: "mine" }, declaring({ e: { default: "dflt" } }), {})).toEqual({
      e: { kind: "value", v: "mine" },
    });
  });

  it("evaluates a caller value in the caller's scope", () => {
    const scope: Scope = { inputs: { q: { kind: "value", v: "z" } } };
    expect(calleeInputs({ m: "${{ inputs.q }}" }, declaring({}), scope)).toEqual({
      m: { kind: "value", v: "z" },
    });
  });

  it("ignores a with: block that is not an object", () => {
    expect(calleeInputs("yes", declaring({ e: { default: "d" } }), {})).toEqual({
      e: { kind: "value", v: "d" },
    });
  });
});
