import { describe, expect, it } from "vitest";
import { expandMatrixDetailed } from "./expandMatrixDetailed.js";

describe("expandMatrixDetailed", () => {
  it("returns a single null combination when there is no matrix", () => {
    expect(expandMatrixDetailed(undefined)).toEqual([null]);
    expect(expandMatrixDetailed({})).toEqual([null]);
  });

  it("shows only the axis keys for a combination an include merged into", () => {
    // The parenthetical in a check name lists axis values, not the extras an
    // include entry attached — but a combination the include *created* shows
    // every key it has.
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
});
