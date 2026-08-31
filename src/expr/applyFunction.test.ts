import { describe, expect, it } from "vitest";
import { applyFunction } from "./applyFunction.js";
import type { Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });

// Names arrive already lowercased by the parser.
describe("applyFunction", () => {
  it("treats always as true", () => {
    expect(applyFunction("always", [])).toEqual(S(true));
  });

  it("dispatches fromjson at arity one only", () => {
    expect(applyFunction("fromjson", [S("[1]")])).toEqual({ kind: "json", v: [1] });
    expect(applyFunction("fromjson", [S("[1]"), S("x")])).toEqual({ kind: "unknown" });
  });

  it("dispatches format at any arity", () => {
    expect(applyFunction("format", [S("{0}!"), S("a")])).toEqual(S("a!"));
    expect(applyFunction("format", [])).toEqual({ kind: "unknown" });
  });

  it("evaluates contains over two known strings", () => {
    expect(applyFunction("contains", [S("abc"), S("b")])).toEqual(S(true));
    expect(applyFunction("contains", [S("abc"), S("z")])).toEqual(S(false));
    expect(applyFunction("contains", [{ kind: "unknown" }, S("b")])).toEqual({ kind: "unknown" });
    expect(applyFunction("contains", [S(1), S(2)])).toEqual({ kind: "unknown" });
    expect(applyFunction("contains", [S("abc")])).toEqual({ kind: "unknown" });
  });

  it("evaluates startswith and endswith", () => {
    expect(applyFunction("startswith", [S("abc"), S("ab")])).toEqual(S(true));
    expect(applyFunction("endswith", [S("abc"), S("bc")])).toEqual(S(true));
    expect(applyFunction("startswith", [{ kind: "truthy" }, S("ab")])).toEqual({ kind: "unknown" });
    expect(applyFunction("endswith", [S("abc"), S(1)])).toEqual({ kind: "unknown" });
  });

  it("leaves every unmodelled function unknown", () => {
    expect(applyFunction("success", [])).toEqual({ kind: "unknown" });
    expect(applyFunction("tojson", [S("a")])).toEqual({ kind: "unknown" });
  });
});
