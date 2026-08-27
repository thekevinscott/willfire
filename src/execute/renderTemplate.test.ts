import { describe, expect, it } from "vitest";
import { renderTemplate } from "./renderTemplate.js";
import type { Scope } from "../expr/val.js";

describe("renderTemplate", () => {
  const scope: Scope = {
    inputs: { who: { kind: "value", v: "world" }, n: { kind: "value", v: 3 } },
  };

  it("renders every ${{ }} to its literal text", () => {
    expect(renderTemplate("hi ${{ inputs.who }}/${{ inputs.n }}", scope)).toBe("hi world/3");
  });

  it("passes text with no expressions through untouched", () => {
    expect(renderTemplate("plain", {})).toBe("plain");
  });

  it("returns null when any expression cannot be settled", () => {
    expect(renderTemplate("a ${{ inputs.who }} ${{ env.nope }}", scope)).toBe(null);
  });
});
