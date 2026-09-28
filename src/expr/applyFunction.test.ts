import { describe, expect, it } from "vitest";
import { applyFunction } from "./applyFunction.js";
import type { Scope, Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });

// Names arrive already lowercased by the parser.
describe("applyFunction", () => {
  it("treats always as true", () => {
    expect(applyFunction("always", [], {})).toEqual(S(true));
  });

  it("settles success and failure false against a skipped need", () => {
    // Measured on probe PR #341, run 36416679059.
    const scope: Scope = { needsSettled: "some-skipped" };
    expect(applyFunction("success", [], scope)).toEqual(S(false));
    expect(applyFunction("failure", [], scope)).toEqual(S(false));
  });

  it("settles success true and failure false when every need ran", () => {
    // Jobs `c` and `d` on probe PR #376, run 36430193559: `success()` ran, and
    // `failure()` produced a check run whose conclusion was `skipped`.
    const scope: Scope = { needsSettled: "all-run" };
    expect(applyFunction("success", [], scope)).toEqual(S(true));
    expect(applyFunction("failure", [], scope)).toEqual(S(false));
  });

  it("settles cancelled false whatever the needs state", () => {
    // willfire answers for a dispatch that happens: job `b` on probe PR #376,
    // run 36430193559, and job `h` there downstream of a skipped need.
    expect(applyFunction("cancelled", [], {})).toEqual(S(false));
    expect(applyFunction("cancelled", [], { needsSettled: "all-run" })).toEqual(S(false));
    expect(applyFunction("cancelled", [], { needsSettled: "some-skipped" })).toEqual(S(false));
  });

  it("leaves success and failure unknown when the needs state is unsettled", () => {
    expect(applyFunction("success", [], {})).toEqual({ kind: "unknown" });
    expect(applyFunction("failure", [], {})).toEqual({ kind: "unknown" });
  });

  it("settles only the job-status functions against a needs state", () => {
    const scope: Scope = { needsSettled: "all-run" };
    expect(applyFunction("tojson", [], scope)).toEqual({ kind: "unknown" });
    expect(applyFunction("format", [], scope)).toEqual({ kind: "unknown" });
  });

  it("refuses arguments on a job-status function", () => {
    expect(applyFunction("success", [S("x")], { needsSettled: "all-run" })).toEqual({
      kind: "unknown",
    });
    expect(applyFunction("cancelled", [S("x")], {})).toEqual({ kind: "unknown" });
  });

  it("dispatches fromjson at arity one only", () => {
    expect(applyFunction("fromjson", [S("[1]")], {})).toEqual({ kind: "json", v: [1] });
    expect(applyFunction("fromjson", [S("[1]"), S("x")], {})).toEqual({ kind: "unknown" });
  });

  it("dispatches format at any arity", () => {
    expect(applyFunction("format", [S("{0}!"), S("a")], {})).toEqual(S("a!"));
    expect(applyFunction("format", [], {})).toEqual({ kind: "unknown" });
  });

  it("evaluates contains over two known strings", () => {
    expect(applyFunction("contains", [S("abc"), S("b")], {})).toEqual(S(true));
    expect(applyFunction("contains", [S("abc"), S("z")], {})).toEqual(S(false));
    expect(applyFunction("contains", [{ kind: "unknown" }, S("b")], {})).toEqual({
      kind: "unknown",
    });
    expect(applyFunction("contains", [S(1), S(2)], {})).toEqual({ kind: "unknown" });
    expect(applyFunction("contains", [S("abc")], {})).toEqual({ kind: "unknown" });
  });

  it("evaluates startswith and endswith", () => {
    expect(applyFunction("startswith", [S("abc"), S("ab")], {})).toEqual(S(true));
    expect(applyFunction("endswith", [S("abc"), S("bc")], {})).toEqual(S(true));
    expect(applyFunction("startswith", [{ kind: "truthy" }, S("ab")], {})).toEqual({
      kind: "unknown",
    });
    expect(applyFunction("endswith", [S("abc"), S(1)], {})).toEqual({ kind: "unknown" });
  });

  it("leaves every unmodelled function unknown", () => {
    expect(applyFunction("success", [], {})).toEqual({ kind: "unknown" });
    expect(applyFunction("tojson", [S("a")], {})).toEqual({ kind: "unknown" });
  });
});
