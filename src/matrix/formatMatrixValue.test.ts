import { describe, expect, it } from "vitest";
import { formatMatrixValue } from "./formatMatrixValue.js";

describe("formatMatrixValue", () => {
  it("renders null and undefined as nothing", () => {
    expect(formatMatrixValue(null)).toBe("");
    expect(formatMatrixValue(undefined)).toBe("");
  });

  it("joins a list value with commas", () => {
    expect(formatMatrixValue([1, 2])).toBe("1, 2");
  });

  it("flattens an object to its own values", () => {
    expect(formatMatrixValue({ os: "linux", arch: "x64" })).toBe("linux, x64");
  });

  it("flattens nested composites recursively", () => {
    expect(formatMatrixValue([["a", "b"], { c: "d" }])).toBe("a, b, d");
  });

  it("stringifies a scalar", () => {
    expect(formatMatrixValue("linux")).toBe("linux");
    expect(formatMatrixValue(20)).toBe("20");
  });

  it("stringifies a falsy scalar rather than dropping it", () => {
    // `experimental: [true, false]` is a real axis, and its second check is
    // named `(false)` — not `()`.
    expect(formatMatrixValue(false)).toBe("false");
    expect(formatMatrixValue(0)).toBe("0");
  });
});
