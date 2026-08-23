import { describe, expect, it } from "vitest";
import { matrixSuffix } from "./matrixSuffix.js";

describe("matrixSuffix", () => {
  it("is empty when the combination has no keys to show", () => {
    expect(matrixSuffix({ values: {}, displayKeys: [] })).toBe("");
  });

  it("skips a display key the combination does not carry", () => {
    expect(matrixSuffix({ values: { a: "x" }, displayKeys: ["a", "gone"] })).toBe(" (x)");
  });

  it("formats the displayed values in order", () => {
    expect(matrixSuffix({ values: { a: "x", b: 2, c: "hidden" }, displayKeys: ["a", "b"] })).toBe(
      " (x, 2)",
    );
  });
});
