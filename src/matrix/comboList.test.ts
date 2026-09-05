import { describe, expect, it, vi } from "vitest";
import { comboList } from "./comboList.js";
import type { Scope } from "../expr/val.js";

// The isolation gate wants collaborators mocked; what an include list resolves
// to is what this suite pins, so the mock passes the real module through.
vi.mock(
  "./interpolateValue.js",
  async () =>
    await vi.importActual<typeof import("./interpolateValue.js")>("./interpolateValue.js"),
);

describe("comboList", () => {
  it("treats an absent block as empty", () => {
    expect(comboList(null, {})).toEqual([]);
    expect(comboList(undefined, {})).toEqual([]);
  });

  it("returns a literal list as itself", () => {
    expect(comboList([{ os: "mac" }], {})).toEqual([{ os: "mac" }]);
  });

  it("evaluates an expression written as an entry's value", () => {
    const scope: Scope = { github: { event_name: "pull_request" } };
    expect(comboList([{ b: "${{ github.event_name }}" }], scope)).toEqual([
      { b: "pull_request" },
    ]);
  });

  it("gives up on an entry value the scope cannot resolve", () => {
    expect(comboList([{ b: "${{ github.run_id }}" }], {})).toBeNull();
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
