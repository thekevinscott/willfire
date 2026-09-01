import { describe, expect, it } from "vitest";
import { comboList } from "./comboList.js";
import type { Scope } from "../expr/val.js";

describe("comboList", () => {
  it("treats an absent block as empty", () => {
    expect(comboList(null, {})).toEqual([]);
    expect(comboList(undefined, {})).toEqual([]);
  });

  it("returns a literal list as itself", () => {
    expect(comboList([{ os: "mac" }], {})).toEqual([{ os: "mac" }]);
  });

  it("resolves an expression through the scope", () => {
    const scope: Scope = { needs: { plan: { outputs: { m: '[{"os":"linux"}]' } } } };
    expect(comboList("${{ fromJSON(needs.plan.outputs.m) }}", scope)).toEqual([{ os: "linux" }]);
  });

  it("gives up on an expression the scope cannot resolve", () => {
    expect(comboList("${{ fromJSON(needs.plan.outputs.m) }}", {})).toBeNull();
  });

  it("gives up on an expression that resolves to a non-list", () => {
    const scope: Scope = { needs: { plan: { outputs: { m: '{"os":"linux"}' } } } };
    expect(comboList("${{ fromJSON(needs.plan.outputs.m) }}", scope)).toBeNull();
  });

  it("gives up on anything that is neither list nor string", () => {
    expect(comboList(42, {})).toBeNull();
  });
});
