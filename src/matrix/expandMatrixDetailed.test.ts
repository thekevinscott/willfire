import { describe, expect, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { expandMatrixDetailed } from "./expandMatrixDetailed.js";

describe("expandMatrixDetailed", () => {
  it("returns a single null combination when there is no matrix", () => {
    expect(expandMatrixDetailed(undefined)).toEqual([null]);
    expect(expandMatrixDetailed({})).toEqual([null]);
  });

  it("shows only the axis keys for a combination an include merged into", () => {
    const combos = expandMatrixDetailed({
      matrix: { a: ["x"], include: [{ a: "x", extra: "e1" }, { a: "z", extra: "e2" }] },
    });
    expect(combos).toEqual([
      { values: { a: "x", extra: "e1" }, displayKeys: ["a"] },
      { values: { a: "z", extra: "e2" }, displayKeys: ["a", "extra"] },
    ]);
  });

  it("gives up on a matrix that is an expression", () => {
    expect(expandMatrixDetailed({ matrix: "${{ fromJSON(x) }}" })).toBeNull();
  });

  it("resolves an axis written as an expression through the scope", () => {
    const scope: Scope = { needs: { d: { outputs: { langs: '["ts","rust"]' } } } };
    expect(
      expandMatrixDetailed({ matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } }, scope),
    ).toEqual([
      { values: { language: "ts" }, displayKeys: ["language"] },
      { values: { language: "rust" }, displayKeys: ["language"] },
    ]);
  });
});
