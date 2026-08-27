import { describe, expect, it } from "vitest";
import { coalesceAnd } from "./coalesceAnd.js";

describe("coalesceAnd", () => {
  it("yields the left when it is falsy", () => {
    expect(coalesceAnd({ kind: "value", v: "" }, { kind: "value", v: "x" })).toEqual({
      kind: "value",
      v: "",
    });
  });

  it("yields the right when the left is truthy", () => {
    expect(coalesceAnd({ kind: "value", v: "a" }, { kind: "value", v: "b" })).toEqual({
      kind: "value",
      v: "b",
    });
  });

  it("is falsy when the left is unknown but the right is falsy", () => {
    expect(coalesceAnd({ kind: "unknown" }, { kind: "value", v: false })).toEqual({ kind: "falsy" });
  });

  it("is unknown when the left is unknown and the right does not settle it", () => {
    expect(coalesceAnd({ kind: "unknown" }, { kind: "value", v: true })).toEqual({
      kind: "unknown",
    });
    expect(coalesceAnd({ kind: "unknown" }, { kind: "unknown" })).toEqual({ kind: "unknown" });
  });
});
