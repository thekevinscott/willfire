import { describe, expect, it } from "vitest";
import { isPlainObject } from "./isPlainObject.js";

describe("isPlainObject", () => {
  it("accepts only what JSON would spell with braces", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(3)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});
