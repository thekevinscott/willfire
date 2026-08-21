import { describe, expect, it } from "vitest";
import { lookupPath } from "./lookupPath.js";

describe("lookupPath", () => {
  it("walks a dotted path", () => {
    expect(lookupPath({ a: { b: "v" } }, "a.b")).toBe("v");
  });

  it("is undefined for a missing segment", () => {
    expect(lookupPath({ a: {} }, "a.b")).toBeUndefined();
  });

  it("is undefined when the walk hits a non-object", () => {
    expect(lookupPath({ a: "scalar" }, "a.b")).toBeUndefined();
  });

  it("is undefined when the walk hits null", () => {
    expect(lookupPath({ a: null }, "a.b")).toBeUndefined();
  });
});
