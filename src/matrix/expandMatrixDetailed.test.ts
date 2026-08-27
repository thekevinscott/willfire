import { describe, expect, it, vi } from "vitest";
import type { Scope } from "../expr/val.js";
import { expandMatrixDetailed } from "./expandMatrixDetailed.js";

// The isolation gate wants collaborators mocked; axis and include/exclude
// resolution are part of the expansion this suite pins, so the mocks pass the
// real modules through.
vi.mock(
  "./axisValues.js",
  async () => await vi.importActual<typeof import("./axisValues.js")>("./axisValues.js"),
);
vi.mock(
  "./comboList.js",
  async () => await vi.importActual<typeof import("./comboList.js")>("./comboList.js"),
);

describe("expandMatrixDetailed", () => {
  it("returns a single null combination when there is no matrix", () => {
    expect(expandMatrixDetailed(undefined)).toEqual([null]);
    expect(expandMatrixDetailed({})).toEqual([null]);
  });

  it("expands two static axes to their full cross product in order", () => {
    expect(expandMatrixDetailed({ matrix: { os: ["linux", "mac"], node: [18, 20] } })).toEqual([
      { values: { os: "linux", node: 18 }, displayKeys: ["os", "node"] },
      { values: { os: "linux", node: 20 }, displayKeys: ["os", "node"] },
      { values: { os: "mac", node: 18 }, displayKeys: ["os", "node"] },
      { values: { os: "mac", node: 20 }, displayKeys: ["os", "node"] },
    ]);
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

  it("resolves an axis written as an expression through the scope", () => {
    // Typed as the expr module's own Scope — the seam this function takes.
    const scope: Scope = { needs: { d: { outputs: { langs: '["ts","rust"]' } } } };
    expect(
      expandMatrixDetailed({ matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } }, scope),
    ).toEqual([
      { values: { language: "ts" }, displayKeys: ["language"] },
      { values: { language: "rust" }, displayKeys: ["language"] },
    ]);
  });

  it("resolves an include: written as an expression through the scope", () => {
    // The plan-job shape: `include: ${{ fromJSON(needs.plan.outputs.matrix) }}`.
    const scope = {
      needs: { plan: { outputs: { matrix: '[{"os":"linux"},{"os":"mac"}]' } } },
    };
    expect(
      expandMatrixDetailed(
        { matrix: { include: "${{ fromJSON(needs.plan.outputs.matrix) }}" } },
        scope,
      ),
    ).toEqual([
      { values: { os: "linux" }, displayKeys: ["os"] },
      { values: { os: "mac" }, displayKeys: ["os"] },
    ]);
  });

  it("resolves an exclude: written as an expression and filters with it", () => {
    const scope = { needs: { plan: { outputs: { drop: '[{"os":"mac"}]' } } } };
    expect(
      expandMatrixDetailed(
        { matrix: { os: ["linux", "mac"], exclude: "${{ fromJSON(needs.plan.outputs.drop) }}" } },
        scope,
      ),
    ).toEqual([{ values: { os: "linux" }, displayKeys: ["os"] }]);
  });

  it("gives up on an include: expression the scope cannot resolve", () => {
    expect(
      expandMatrixDetailed({ matrix: { include: "${{ fromJSON(needs.plan.outputs.matrix) }}" } }),
    ).toBeNull();
  });

  it("gives up on an include: that is neither a list nor a string", () => {
    expect(expandMatrixDetailed({ matrix: { include: 5 } })).toBeNull();
  });

  it("gives up on an include: expression that resolves to a non-list", () => {
    const scope = { needs: { plan: { outputs: { matrix: '{"os":"linux"}' } } } };
    expect(
      expandMatrixDetailed(
        { matrix: { include: "${{ fromJSON(needs.plan.outputs.matrix) }}" } },
        scope,
      ),
    ).toBeNull();
  });

  it("gives up on an axis that is neither a list nor an expression", () => {
    expect(expandMatrixDetailed({ matrix: { os: 5 } })).toBeNull();
  });

  it("gives up on an axis expression the scope cannot resolve", () => {
    expect(
      expandMatrixDetailed({ matrix: { os: "${{ fromJSON(needs.plan.outputs.os) }}" } }),
    ).toBeNull();
  });
});
