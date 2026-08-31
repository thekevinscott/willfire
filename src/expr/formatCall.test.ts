import { describe, expect, it } from "vitest";
import { formatCall } from "./formatCall.js";
import type { Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });

describe("formatCall", () => {
  it("substitutes positional slots", () => {
    expect(formatCall([S("{0}-{1}"), S("a"), S("b")])).toEqual(S("a-b"));
  });

  it("repeats a slot referenced twice", () => {
    expect(formatCall([S("{0}/{0}"), S("x")])).toEqual(S("x/x"));
  });

  it("coerces non-string arguments the way the runner does", () => {
    expect(formatCall([S("{0}{1}"), S(2), S(true)])).toEqual(S("2true"));
  });

  it("unescapes doubled braces", () => {
    expect(formatCall([S("{{{0}}}"), S("v")])).toEqual(S("{v}"));
  });

  it("is unknown without a format string", () => {
    expect(formatCall([])).toEqual({ kind: "unknown" });
  });

  it("is unknown when the format string is not a known string", () => {
    expect(formatCall([{ kind: "unknown" }, S("a")])).toEqual({ kind: "unknown" });
    expect(formatCall([S(1), S("a")])).toEqual({ kind: "unknown" });
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
