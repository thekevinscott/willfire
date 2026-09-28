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

  // Probe #383, runs 36430453573 and 36431899972. Every row was read off a
  // live job's conclusion: success is true, skipped is false.
  it("casts a mixed-type comparison to numbers", () => {
    expect(compare("==", S("1"), S(1))).toEqual(S(true));
    expect(compare("==", S(""), S(0))).toEqual(S(true));
    expect(compare("==", S("  "), S(0))).toEqual(S(true));
    expect(compare("==", S("0x1f"), S(31))).toEqual(S(true));
    expect(compare("==", S(0), S(false))).toEqual(S(true));
    expect(compare("<", S("2"), S(10))).toEqual(S(true));
    expect(compare(">=", S("2"), S(2))).toEqual(S(true));
    expect(compare(">", S("10"), S(9))).toEqual(S(true));
  });

  it("makes a NaN cast false under == and ordering, true under !=", () => {
    expect(compare("==", S("abc"), S(0))).toEqual(S(false));
    expect(compare("==", S(true), S("true"))).toEqual(S(false));
    expect(compare("!=", S("abc"), S(0))).toEqual(S(true));
    expect(compare("!=", S(true), S("true"))).toEqual(S(true));
    expect(compare("!=", S(""), S(0))).toEqual(S(false));
    expect(compare("<", S("abc"), S(0))).toEqual(S(false));
    expect(compare(">", S("abc"), S(0))).toEqual(S(false));
    expect(compare(">=", S("abc"), S(0))).toEqual(S(false));
    // `<=` is the one direction the probe did not dispatch; the other three
    // came back false and `!=` came back as the negation of `==`.
    expect(compare("<=", S("abc"), S(0))).toEqual(S(false));
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
