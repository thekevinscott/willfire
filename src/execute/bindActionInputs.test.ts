import { describe, expect, it } from "vitest";
import { bindActionInputs } from "./bindActionInputs.js";

describe("bindActionInputs", () => {
  it("binds declared defaults, the caller's with: winning", () => {
    const action = { inputs: { who: { default: "d" }, other: {} } };
    expect(bindActionInputs(action, { who: "w" }, {})).toEqual({
      who: { kind: "value", v: "w" },
      other: { kind: "value", v: "" },
    });
  });

  it("binds a declaration that is not a map as the empty string", () => {
    // `inputs:\n  x:` parses to null; reading `default` off either shape would throw.
    for (const decl of ["str", null]) {
      expect(bindActionInputs({ inputs: { x: decl } }, undefined, {})).toEqual({
        x: { kind: "value", v: "" },
      });
    }
  });

  it("binds the caller's with: over an action that declares no inputs at all", () => {
    expect(bindActionInputs(null, { who: "w" }, {})).toEqual({ who: { kind: "value", v: "w" } });
  });

  it("ignores a with: that is not a map", () => {
    // `with:` with nothing under it parses to null; a scalar is malformed.
    for (const withBlock of [null, "scalar"]) {
      expect(bindActionInputs({}, withBlock, {})).toEqual({});
    }
  });

  it("stringifies booleans and numbers, and null as the empty string", () => {
    expect(bindActionInputs({}, { flag: true, n: 3, x: null }, {})).toEqual({
      flag: { kind: "value", v: "true" },
      n: { kind: "value", v: "3" },
      x: { kind: "value", v: "" },
    });
  });

  it("renders template values, leaving unrenderable ones unknown", () => {
    const scope = { github: { repository: "o/r" } };
    const out = bindActionInputs({}, { a: "${{ github.repository }}", b: "${{ env.nope }}" }, scope);
    expect(out.a).toEqual({ kind: "value", v: "o/r" });
    expect(out.b.kind).toBe("unknown");
  });
});
