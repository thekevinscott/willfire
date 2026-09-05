import { describe, expect, it } from "vitest";
import { interpolateValue } from "./interpolateValue.js";
import type { Scope } from "../expr/val.js";

const PR: Scope = { github: { event_name: "pull_request" } };

describe("interpolateValue", () => {
  it("leaves a value holding no expression alone", () => {
    expect(interpolateValue("plain", PR)).toEqual({ v: "plain" });
    expect(interpolateValue(18, PR)).toEqual({ v: 18 });
    expect(interpolateValue(null, PR)).toEqual({ v: null });
  });

  it("evaluates an expression to its value", () => {
    expect(interpolateValue("${{ github.event_name }}", PR)).toEqual({ v: "pull_request" });
  });

  it("keeps a structured value whole", () => {
    const scope: Scope = { needs: { d: { outputs: { cfg: '{"os":"linux"}' } } } };
    expect(interpolateValue("${{ fromJSON(needs.d.outputs.cfg) }}", scope)).toEqual({
      v: { os: "linux" },
    });
  });

  it("reaches every element of a list", () => {
    expect(interpolateValue(["plain", "${{ github.event_name }}"], PR)).toEqual({
      v: ["plain", "pull_request"],
    });
  });

  it("reaches every value of a map", () => {
    expect(interpolateValue({ b: "${{ github.event_name }}", c: "plain" }, PR)).toEqual({
      v: { b: "pull_request", c: "plain" },
    });
  });

  it("gives up on an expression the scope cannot settle", () => {
    expect(interpolateValue("${{ github.run_id }}", PR)).toBeNull();
  });

  it("gives up on a list holding one it cannot settle", () => {
    expect(interpolateValue(["plain", "${{ github.run_id }}"], PR)).toBeNull();
  });

  it("gives up on a map holding one it cannot settle", () => {
    expect(interpolateValue({ b: "${{ github.run_id }}" }, PR)).toBeNull();
  });

  it("gives up on text an expression only partly fills", () => {
    // `node-${{ ... }}` is interpolation rather than an expression, which the
    // evaluator does not model. A half-rendered name is worse than an unknown.
    expect(interpolateValue("node-${{ github.event_name }}", PR)).toBeNull();
  });
});
