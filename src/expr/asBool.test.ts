import { describe, expect, it } from "vitest";
import { asBool } from "./asBool.js";

describe("asBool", () => {
  it("wraps a decided boolean as a concrete value", () => {
    expect(asBool(true)).toEqual({ kind: "value", v: true });
    expect(asBool(false)).toEqual({ kind: "value", v: false });
  });

  it("keeps an undecided answer unknown", () => {
    expect(asBool(null)).toEqual({ kind: "unknown" });
  });
});
