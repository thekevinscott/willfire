import { describe, expect, it, vi } from "vitest";
import { axisValues } from "./axisValues.js";
import type { Scope } from "../expr/val.js";

// The isolation gate wants collaborators mocked; what an axis resolves to is
// what this suite pins, so the mock passes the real module through.
vi.mock(
  "./interpolateValue.js",
  async () =>
    await vi.importActual<typeof import("./interpolateValue.js")>("./interpolateValue.js"),
);

describe("axisValues", () => {
  it("returns a literal list as itself", () => {
    expect(axisValues(["a", "b"], {})).toEqual(["a", "b"]);
  });

  it("evaluates an expression written as a list element", () => {
    const scope: Scope = { github: { event_name: "pull_request" } };
    expect(axisValues(["plain", "${{ github.event_name }}"], scope)).toEqual([
      "plain",
      "pull_request",
    ]);
  });

  it("gives up on a list element the scope cannot resolve", () => {
    expect(axisValues(["plain", "${{ github.run_id }}"], {})).toBeNull();
  });

  it("resolves an expression through the scope", () => {
    const scope: Scope = { needs: { d: { outputs: { langs: '["ts","rust"]' } } } };
    expect(axisValues("${{ fromJSON(needs.d.outputs.langs) }}", scope)).toEqual(["ts", "rust"]);
  });

  it("gives up on an expression the scope cannot resolve", () => {
    expect(axisValues("${{ fromJSON(needs.d.outputs.langs) }}", {})).toBeNull();
  });

  it("gives up on an expression that resolves to a non-list", () => {
    const scope: Scope = { needs: { d: { outputs: { langs: '{"ts":true}' } } } };
    expect(axisValues("${{ fromJSON(needs.d.outputs.langs) }}", scope)).toBeNull();
  });

  it("gives up on anything that is neither list nor string", () => {
    expect(axisValues(42, {})).toBeNull();
  });
});
