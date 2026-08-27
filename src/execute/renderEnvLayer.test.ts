import { describe, expect, it } from "vitest";
import { renderEnvLayer } from "./renderEnvLayer.js";
import type { Scope } from "../expr/val.js";

describe("renderEnvLayer", () => {
  it("renders a missing layer as the empty map", () => {
    expect(renderEnvLayer(null, {})).toEqual({ ok: true, v: {} });
    expect(renderEnvLayer(undefined, {})).toEqual({ ok: true, v: {} });
  });

  it("refuses a layer that is not a map", () => {
    expect(renderEnvLayer([], {})).toEqual({ ok: false, reason: "env block is not a map" });
    expect(renderEnvLayer("A=1", {})).toEqual({ ok: false, reason: "env block is not a map" });
  });

  it("renders each value, null becoming the empty string", () => {
    const scope: Scope = { inputs: { x: { kind: "value", v: "i" } } };
    expect(renderEnvLayer({ A: "${{ inputs.x }}", B: null, C: 3 }, scope)).toEqual({
      ok: true,
      v: { A: "i", B: "", C: "3" },
    });
  });

  it("names the key it cannot resolve", () => {
    expect(renderEnvLayer({ K: "${{ env.nope }}" }, {})).toEqual({
      ok: false,
      reason: "cannot resolve env 'K'",
    });
  });
});
