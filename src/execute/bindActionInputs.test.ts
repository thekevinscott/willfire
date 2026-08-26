import { describe, expect, it } from "vitest";
import { bindActionInputs } from "./bindActionInputs.js";

describe("bindActionInputs", () => {
  it("binds declared defaults, empty string when a declaration has none", () => {
    const action = { inputs: { who: { default: "d" }, other: {}, bare: null } };
    expect(bindActionInputs(action, undefined, {})).toEqual({
      who: { kind: "value", v: "d" },
      other: { kind: "value", v: "" },
      bare: { kind: "value", v: "" },
    });
  });

  it("lets the caller's with: win, stringifying non-strings", () => {
    const action = { inputs: { who: { default: "d" } } };
    const out = bindActionInputs(action, { who: "w", flag: true, n: 3, empty: null }, {});
    expect(out).toEqual({
      who: { kind: "value", v: "w" },
      flag: { kind: "value", v: "true" },
      n: { kind: "value", v: "3" },
      empty: { kind: "value", v: "" },
    });
  });

  it("renders expressions against the caller's scope", () => {
    const scope = { inputs: { x: { kind: "value", v: "i" } as const } };
    expect(bindActionInputs({}, { who: "${{ inputs.x }}" }, scope)).toEqual({
      who: { kind: "value", v: "i" },
    });
  });

  it("leaves an unrenderable value unknown rather than failing", () => {
    const out = bindActionInputs({}, { who: "${{ env.nope }}" }, {});
    expect(out.who.kind).toBe("unknown");
  });
});
