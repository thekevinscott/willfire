import { describe, expect, it } from "vitest";
import { inputLiteral } from "./inputLiteral.js";

describe("inputLiteral", () => {
  it("renders a missing value as the empty string", () => {
    expect(inputLiteral(null)).toEqual({ kind: "value", v: "" });
    expect(inputLiteral(undefined)).toEqual({ kind: "value", v: "" });
  });

  it("passes booleans and numbers through", () => {
    expect(inputLiteral(true)).toEqual({ kind: "value", v: true });
    expect(inputLiteral(3)).toEqual({ kind: "value", v: 3 });
  });

  it("passes a plain string through", () => {
    expect(inputLiteral("x")).toEqual({ kind: "value", v: "x" });
  });

  it("leaves an expression-bearing string unknown", () => {
    expect(inputLiteral("${{ inputs.x }}")).toEqual({ kind: "unknown" });
  });

  it("leaves a structured value unknown", () => {
    expect(inputLiteral({ a: 1 })).toEqual({ kind: "unknown" });
  });
});
