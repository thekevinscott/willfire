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

  it("stringifies a scalar", () => {
    expect(formatMatrixValue("linux")).toBe("linux");
    expect(formatMatrixValue(20)).toBe("20");
  });
});
