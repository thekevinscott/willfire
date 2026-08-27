import { describe, expect, it } from "vitest";
import { coalesceOr } from "./coalesceOr.js";

describe("coalesceOr", () => {
  it("yields the left when it is truthy", () => {
    expect(coalesceOr({ kind: "value", v: "a" }, { kind: "value", v: "b" })).toEqual({
      kind: "value",
      v: "a",
    });
  });

  it("yields the right when the left is falsy", () => {
    expect(coalesceOr({ kind: "value", v: "" }, { kind: "value", v: "b" })).toEqual({
      kind: "value",
      v: "b",
    });
  });

  it("is truthy when the left is unknown but the right is truthy", () => {
    expect(coalesceOr({ kind: "unknown" }, { kind: "value", v: true })).toEqual({ kind: "truthy" });
  });

  it("is unknown when the left is unknown and the right does not settle it", () => {
    expect(coalesceOr({ kind: "unknown" }, { kind: "value", v: false })).toEqual({
      kind: "unknown",
    });
  });
});
