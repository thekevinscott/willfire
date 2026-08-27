import { describe, expect, it } from "vitest";
import { axisValues } from "./axisValues.js";
import type { Scope } from "../expr/val.js";

describe("axisValues", () => {
  it("returns a literal list as itself", () => {
    expect(axisValues(["a", "b"], {})).toEqual(["a", "b"]);
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
