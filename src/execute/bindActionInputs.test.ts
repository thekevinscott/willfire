import { describe, expect, it } from "vitest";
import { bindActionInputs } from "./bindActionInputs.js";
import type { ActionModel } from "./types.js";

describe("bindActionInputs", () => {
  it("binds declared defaults, the caller's with: winning", () => {
    const action = { inputs: { who: { default: "d" }, other: {} } };
    expect(bindActionInputs(action, { who: "w" }, {})).toEqual({
      who: { kind: "value", v: "w" },
      other: { kind: "value", v: "" },
    });
  });

  it("binds a declaration that is not a map as the empty string", () => {
    expect(bindActionInputs({ inputs: { x: "str" } }, undefined, {})).toEqual({
      x: { kind: "value", v: "" },
    });
  });

  it("stringifies booleans and numbers, and null as the empty string", () => {
    expect(bindActionInputs({}, { flag: true, n: 3, x: null }, {})).toEqual({
      flag: { kind: "value", v: "true" },
      n: { kind: "value", v: "3" },
      x: { kind: "value", v: "" },
    });
  });

  it("binds a null action's with: entries — YAML parses an empty manifest to null", () => {
    expect(bindActionInputs(null as unknown as ActionModel, { a: "x" }, {})).toEqual({
      a: { kind: "value", v: "x" },
    });
  });

  it("renders template values, leaving unrenderable ones unknown", () => {
    const scope = { github: { repository: "o/r" } };
    const out = bindActionInputs({}, { a: "${{ github.repository }}", b: "${{ env.nope }}" }, scope);
    expect(out.a).toEqual({ kind: "value", v: "o/r" });
    expect(out.b.kind).toBe("unknown");
  });
});
