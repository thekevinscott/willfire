import { describe, expect, it } from "vitest";
import { renderEnvLayer } from "./renderEnvLayer.js";

describe("renderEnvLayer", () => {
  it("renders an absent block as the empty layer", () => {
    expect(renderEnvLayer(null, {})).toEqual({ ok: true, v: {} });
    expect(renderEnvLayer(undefined, {})).toEqual({ ok: true, v: {} });
  });

  it("refuses a block that is not a map", () => {
    expect(renderEnvLayer([], {})).toEqual({ ok: false, reason: "env block is not a map" });
    expect(renderEnvLayer("x", {})).toEqual({ ok: false, reason: "env block is not a map" });
  });

  it("renders each value against the scope, null as the empty string", () => {
    const scope = { github: { repository: "o/r" } };
    expect(renderEnvLayer({ A: "x-${{ github.repository }}", B: null }, scope)).toEqual({
      ok: true,
      v: { A: "x-o/r", B: "" },
    });
  });

  it("fails the whole layer on one unresolvable value", () => {
    expect(renderEnvLayer({ A: "ok", K: "${{ env.nope }}" }, {})).toEqual({
      ok: false,
      reason: "cannot resolve env 'K'",
    });
  });
});
