import { describe, expect, it } from "vitest";
import { formatCall } from "./formatCall.js";
import type { Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });

describe("formatCall", () => {
  it("substitutes positional slots", () => {
    expect(formatCall([S("{0}-{1}"), S("a"), S("b")])).toEqual(S("a-b"));
  });

  it("keeps the literal text around a slot", () => {
    expect(formatCall([S("a{0}b"), S("x")])).toEqual(S("axb"));
  });

  it("repeats a slot referenced twice", () => {
    expect(formatCall([S("{0}/{0}"), S("x")])).toEqual(S("x/x"));
  });

  it("reads a multi-digit index", () => {
    const args = Array.from({ length: 11 }, (_, i) => S(`a${String(i)}`));
    expect(formatCall([S("{10}"), ...args])).toEqual(S("a10"));
  });

  it("coerces non-string arguments the way the runner does", () => {
    expect(formatCall([S("{0}{1}"), S(2), S(true)])).toEqual(S("2true"));
  });

  it("coerces a non-string format string too", () => {
    expect(formatCall([S(7)])).toEqual(S("7"));
  });

  it("unescapes doubled braces", () => {
    expect(formatCall([S("{{{0}}}"), S("v")])).toEqual(S("{v}"));
  });

  it("is unknown without a format string", () => {
    expect(formatCall([])).toEqual({ kind: "unknown" });
  });

  it("is unknown when the format string is not a known value", () => {
    expect(formatCall([{ kind: "unknown" }, S("a")])).toEqual({ kind: "unknown" });
  });

  it("is unknown when a referenced slot has no argument", () => {
    // The runner errors on an out-of-range index, so there is no value to guess.
    expect(formatCall([S("{0}-{1}"), S("a")])).toEqual({ kind: "unknown" });
  });

  it("is unknown when a referenced argument is itself unknown", () => {
    expect(formatCall([S("{0}"), { kind: "truthy" }])).toEqual({ kind: "unknown" });
  });

  it("ignores an argument no slot references", () => {
    expect(formatCall([S("{0}"), S("a"), { kind: "unknown" }])).toEqual(S("a"));
  });
});
