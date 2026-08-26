import { describe, expect, it } from "vitest";
import { renderTemplate } from "./renderTemplate.js";

describe("renderTemplate", () => {
  it("leaves text with no expressions untouched", () => {
    expect(renderTemplate("plain $text", {})).toBe("plain $text");
  });

  it("renders every expression to its value", () => {
    const scope = { inputs: { x: { kind: "value", v: "hi" } as const } };
    expect(renderTemplate("a ${{ inputs.x }} b ${{ inputs.x }}", scope)).toBe("a hi b hi");
  });

  it("yields null when any expression cannot be settled", () => {
    expect(renderTemplate("a ${{ env.nope }} b", {})).toBe(null);
  });
});
