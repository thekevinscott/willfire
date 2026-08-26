import { describe, expect, it } from "vitest";
import { renderEnvLayer } from "./renderEnvLayer.js";

describe("renderEnvLayer", () => {
  it("treats an absent layer as empty", () => {
    expect(renderEnvLayer(null, {})).toEqual({ ok: true, v: {} });
    expect(renderEnvLayer(undefined, {})).toEqual({ ok: true, v: {} });
  });

  it("refuses a layer that is not a map", () => {
    expect(renderEnvLayer([], {})).toEqual({ ok: false, reason: "env block is not a map" });
    expect(renderEnvLayer("A=1", {})).toEqual({ ok: false, reason: "env block is not a map" });
  });

  it("renders every value, null values as the empty string", () => {
    const scope = { inputs: { x: { kind: "value", v: "i" } as const } };
    expect(renderEnvLayer({ A: "plain", B: "${{ inputs.x }}", C: null }, scope)).toEqual({
      ok: true,
      v: { A: "plain", B: "i", C: "" },
    });
  });

  it("fails the whole layer on one unresolvable value", () => {
    expect(renderEnvLayer({ A: "ok", B: "${{ env.nope }}" }, {})).toEqual({
      ok: false,
      reason: "cannot resolve env 'B'",
    });
  });
});
