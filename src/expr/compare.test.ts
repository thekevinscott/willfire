import { describe, expect, it } from "vitest";
import { compare } from "./compare.js";
import type { Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });

describe("compare", () => {
  it("decides equality and ordering on matching primitives", () => {
    expect(compare("==", S("a"), S("a"))).toEqual(S(true));
    expect(compare("!=", S("a"), S("a"))).toEqual(S(false));
    expect(compare("<", S(1), S(2))).toEqual(S(true));
    expect(compare("<=", S(2), S(2))).toEqual(S(true));
    expect(compare(">", S(1), S(2))).toEqual(S(false));
    expect(compare(">=", S(1), S(2))).toEqual(S(false));
  });

  it("refuses mixed primitive types", () => {
    expect(compare("==", S("1"), S(1))).toEqual({ kind: "unknown" });
  });

  it("refuses to order booleans", () => {
    expect(compare("<", S(true), S(false))).toEqual({ kind: "unknown" });
  });

  it("refuses sides that are not concrete values", () => {
    expect(compare("==", { kind: "unknown" }, S("a"))).toEqual({ kind: "unknown" });
    expect(compare("==", { kind: "falsy" }, S(""))).toEqual({ kind: "unknown" });
  });

  it("compares a json side by instance: never equal, never ordered", () => {
    const arr: Val = { kind: "json", v: [1] };
    expect(compare("==", arr, S("[1]"))).toEqual(S(false));
    expect(compare("!=", S("[1]"), arr)).toEqual(S(true));
    expect(compare("<", arr, S("x"))).toEqual({ kind: "unknown" });
  });
});
