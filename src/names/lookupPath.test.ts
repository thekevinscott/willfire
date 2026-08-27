import { describe, expect, expectTypeOf, it } from "vitest";
import type { YamlValue } from "../yamlValue.js";
import { lookupPath } from "./lookupPath.js";

describe("lookupPath", () => {
  it("walks a dotted path", () => {
    expect(lookupPath({ a: { b: "v" } }, "a.b")).toBe("v");
  });

  it("takes a document value, not `any`", () => {
    expectTypeOf(lookupPath).parameter(0).not.toBeAny();
  });

  it("indexes a sequence by position", () => {
    // `in` holds for an array's numeric keys, so a matrix axis reads through
    // the same walk a mapping does.
    expect(lookupPath({ a: [1, "x"] }, "a.1")).toBe("x");
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
