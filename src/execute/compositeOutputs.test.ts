import { describe, expect, it } from "vitest";
import { compositeOutputs } from "./compositeOutputs.js";

describe("compositeOutputs", () => {
  it("renders every declared output against the finished-steps scope", () => {
    const action = {
      outputs: {
        built: { value: "${{ steps.b.outputs.file }}" },
        plain: { value: "static" },
      },
    };
    const scope = { steps: { b: { outputs: { file: "dist/app.js" } } } };
    expect(compositeOutputs(action, "own/act@v1", "step '#1'", scope)).toEqual({
      ok: true,
      v: { built: "dist/app.js", plain: "static" },
    });
  });

  it("returns an empty map when nothing is declared", () => {
    expect(compositeOutputs({}, "own/act@v1", "step '#1'", {})).toEqual({ ok: true, v: {} });
  });

  it("fails on a declaration with no value", () => {
    expect(compositeOutputs({ outputs: { x: null } }, "own/act@v1", "step '#1'", {})).toEqual({
      ok: false,
      reason: "step '#1': output 'x' of own/act@v1 has no value",
    });
  });

  it("fails when an output's template cannot be resolved", () => {
    const action = { outputs: { x: { value: "${{ steps.missing.outputs.y }}" } } };
    expect(compositeOutputs(action, "own/act@v1", "step '#1'", { steps: {} })).toEqual({
      ok: false,
      reason: "step '#1': cannot resolve output 'x' of own/act@v1",
    });
  });
});
