import { describe, expect, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { expandMatrix } from "./expandMatrix.js";

describe("expandMatrix", () => {
  it("returns a single null combination when there is no strategy", () => {
    expect(expandMatrix(undefined)).toEqual([null]);
    expect(expandMatrix({})).toEqual([null]);
    // `strategy:` written with no value parses to null, not an empty block.
    expect(expandMatrix(null)).toEqual([null]);
  });

  it("gives up on a matrix that is an expression", () => {
    expect(expandMatrix({ matrix: "${{ fromJSON(x) }}" })).toBeNull();
  });

  it("gives up on an expression under include or exclude", () => {
    expect(expandMatrix({ matrix: { include: "${{ x }}" } })).toBeNull();
    expect(expandMatrix({ matrix: { exclude: "${{ x }}" } })).toBeNull();
  });

  it("gives up on an axis that is not a list", () => {
    expect(expandMatrix({ matrix: { os: "${{ x }}" } })).toBeNull();
    expect(expandMatrix({ matrix: { os: 3 } })).toBeNull();
  });

  it("expands an axis written as an expression over known outputs", () => {
    // The fleet shape: the axis is the values another job computed, and they
    // are knowable exactly when the scope carries that job's outputs.
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    // Typed as the expr module's own Scope — the seam expandMatrix takes.
    const scope: Scope = { needs: { d: { outputs: { langs: '["typescript","rust"]' } } } };
    expect(expandMatrix(strategy, scope)).toEqual([
      { language: "typescript" },
      { language: "rust" },
    ]);
  });

  it("expands such an axis to nothing when the output is an empty array", () => {
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    expect(expandMatrix(strategy, { needs: { d: { outputs: { langs: "[]" } } } })).toEqual([]);
  });

  it("multiplies a dynamic axis against a static one", () => {
    const strategy = {
      matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}", os: ["linux"] },
    };
    const scope = { needs: { d: { outputs: { langs: '["ts"]' } } } };
    expect(expandMatrix(strategy, scope)).toEqual([{ language: "ts", os: "linux" }]);
  });

  it("gives up on an axis expression the scope cannot settle", () => {
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    expect(expandMatrix(strategy)).toBeNull();
    expect(expandMatrix(strategy, { needs: { other: { outputs: {} } } })).toBeNull();
  });

  it("gives up on an axis expression that is not an array", () => {
    // A scalar cannot be an axis, and neither can an object. Treating either
    // as one combination would invent a check name.
    const scope = { needs: { d: { outputs: { s: '"ts"', o: "{}" } } } };
    expect(expandMatrix({ matrix: { l: "${{ fromJSON(needs.d.outputs.s) }}" } }, scope)).toBeNull();
    expect(expandMatrix({ matrix: { l: "${{ fromJSON(needs.d.outputs.o) }}" } }, scope)).toBeNull();
  });

  it("takes the cartesian product of the axes", () => {
    expect(expandMatrix({ matrix: { os: ["linux", "mac"], node: [20, 22] } })).toEqual([
      { os: "linux", node: 20 },
      { os: "linux", node: 22 },
      { os: "mac", node: 20 },
      { os: "mac", node: 22 },
    ]);
  });

  it("drops excluded combinations", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux", "mac"], exclude: [{ os: "mac" }] } }),
    ).toEqual([{ os: "linux" }]);
  });

  it("returns no combinations when everything is excluded", () => {
    expect(expandMatrix({ matrix: { os: ["linux"], exclude: [{ os: "linux" }] } })).toEqual([]);
  });

  it("returns no combinations when any axis is empty", () => {
    // The product with an empty axis is empty, however many values the other
    // axes carry.
    expect(expandMatrix({ matrix: { a: [], b: ["x"] } })).toEqual([]);
    expect(expandMatrix({ matrix: { a: ["x"], b: [] } })).toEqual([]);
    expect(expandMatrix({ matrix: { a: [], b: [] } })).toEqual([]);
  });

  it("returns no combinations for a matrix with no keys", () => {
    // Distinct from an absent `matrix:`, which is the single-unsuffixed-job
    // case above.
    expect(expandMatrix({ matrix: {} })).toEqual([]);
  });

  it("merges an include that overlaps an existing combination", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux", "mac"], include: [{ os: "mac", flag: "x" }] } }),
    ).toEqual([{ os: "linux" }, { os: "mac", flag: "x" }]);
  });

  it("appends an include that overlaps no existing combination", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux"], include: [{ os: "mac", flag: "x" }] } }),
    ).toEqual([{ os: "linux" }, { os: "mac", flag: "x" }]);
  });

  it("appends an include that shares no axis at all", () => {
    expect(expandMatrix({ matrix: { include: [{ flag: "x" }] } })).toEqual([{ flag: "x" }]);
  });
});
