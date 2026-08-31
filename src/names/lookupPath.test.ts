import { describe, expect, it } from "vitest";
import type { YamlValue } from "../yamlValue.js";
import { lookupPath } from "./lookupPath.js";

describe("lookupPath", () => {
  it("walks a dotted path", () => {
    expect(lookupPath({ a: { b: "v" } }, "a.b")).toBe("v");
  });

  it("hands back a document value, not `unknown`", () => {
    const found: YamlValue | undefined = lookupPath({ a: { b: [1, "x"] } }, "a.b");
    expect(found).toEqual([1, "x"]);
  });

  it("is undefined for a missing segment", () => {
    expect(lookupPath({ a: {} }, "a.b")).toBeUndefined();
  });

  it("stops at a missing middle segment", () => {
    expect(lookupPath({ a: { b: 1 } }, "a.c.d")).toBeUndefined();
  });

  it("is undefined when the walk hits a non-object", () => {
    expect(lookupPath({ a: "scalar" }, "a.b")).toBeUndefined();
  });

  it("is undefined when the walk hits null", () => {
    expect(lookupPath({ a: null }, "a.b")).toBeUndefined();
  });
});
