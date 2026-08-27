import { describe, expect, it } from "vitest";
import { bindActionInputs } from "./bindActionInputs.js";
import type { Scope } from "../expr/val.js";

describe("bindActionInputs", () => {
  const action = { inputs: { who: { default: "default-who" }, other: {}, gone: null } };

  it("binds declared defaults, empty where none is declared", () => {
    expect(bindActionInputs(action, undefined, {})).toEqual({
      who: { kind: "value", v: "default-who" },
      other: { kind: "value", v: "" },
      gone: { kind: "value", v: "" },
    });
  });

  it("lays caller with: values over the defaults", () => {
    expect(bindActionInputs(action, { who: "caller-who" }, {}).who).toEqual({
      kind: "value",
      v: "caller-who",
    });
  });

  it("stringifies booleans and numbers, and binds null as empty", () => {
    expect(bindActionInputs({}, { flag: true, n: 3, x: null }, {})).toEqual({
      flag: { kind: "value", v: "true" },
      n: { kind: "value", v: "3" },
      x: { kind: "value", v: "" },
    });
  });

  it("renders a templated value against the caller scope", () => {
    const scope: Scope = { inputs: { x: { kind: "value", v: "i" } } };
    expect(bindActionInputs({}, { who: "${{ inputs.x }}" }, scope)).toEqual({
      who: { kind: "value", v: "i" },
    });
  });

  it("leaves an unrenderable value unknown rather than failing", () => {
    // It only matters if a step actually reads it; the read is where the
    // failure is honest.
    expect(bindActionInputs({}, { who: "${{ env.nope }}" }, {})).toEqual({
      who: { kind: "unknown" },
    });
  });
});
