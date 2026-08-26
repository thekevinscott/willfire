import { describe, expect, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { inputValue } from "./inputValue.js";

const SCOPE: Scope = { inputs: { x: { kind: "value", v: "ts" }, n: { kind: "value", v: 5 } } };

describe("inputValue", () => {
  it("reads an absent value as the empty string", () => {
    expect(inputValue(null, {})).toEqual({ kind: "value", v: "" });
    expect(inputValue(undefined, {})).toEqual({ kind: "value", v: "" });
  });

  it("passes booleans and numbers through with their types", () => {
    expect(inputValue(true, {})).toEqual({ kind: "value", v: true });
    expect(inputValue(5, {})).toEqual({ kind: "value", v: 5 });
  });

  it("refuses a structured value", () => {
    expect(inputValue([1], {})).toEqual({ kind: "unknown" });
  });

  it("passes a plain string through untouched", () => {
    expect(inputValue("txt", {})).toEqual({ kind: "value", v: "txt" });
  });

  it("keeps a whole-expression value's evaluated type", () => {
    expect(inputValue("${{ inputs.n }}", SCOPE)).toEqual({ kind: "value", v: 5 });
    // Surrounding whitespace does not demote it to the render path.
    expect(inputValue("  ${{ inputs.n }}  ", SCOPE)).toEqual({ kind: "value", v: 5 });
  });

  it("renders mixed text to a string", () => {
    expect(inputValue("on-${{ inputs.x }}", SCOPE)).toEqual({ kind: "value", v: "on-ts" });
  });

  it("takes the render path for two expressions in one value", () => {
    expect(inputValue("${{ inputs.x }} ${{ inputs.x }}", SCOPE)).toEqual({
      kind: "value",
      v: "ts ts",
    });
  });

  it("stays unknown when either path cannot resolve", () => {
    expect(inputValue("${{ needs.p.outputs.m }}", {})).toEqual({ kind: "unknown" });
    expect(inputValue("x-${{ needs.p.outputs.m }}", {})).toEqual({ kind: "unknown" });
  });
});
