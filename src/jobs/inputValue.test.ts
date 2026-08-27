import { describe, expect, it } from "vitest";
import { inputValue } from "./inputValue.js";

describe("inputValue", () => {
  it("settles an absent value to the empty string", () => {
    expect(inputValue(null, {})).toEqual({ kind: "value", v: "" });
    expect(inputValue(undefined, {})).toEqual({ kind: "value", v: "" });
  });

  it("keeps a boolean or number as itself", () => {
    expect(inputValue(true, {})).toEqual({ kind: "value", v: true });
    expect(inputValue(3, {})).toEqual({ kind: "value", v: 3 });
  });

  it("gives up on a structured value", () => {
    expect(inputValue(["a"], {})).toEqual({ kind: "unknown" });
  });

  it("keeps a plain string as itself", () => {
    expect(inputValue("plain", {})).toEqual({ kind: "value", v: "plain" });
  });

  it("evaluates a whole-expression value, keeping its type", () => {
    expect(inputValue("${{ github.event_name }}", {})).toEqual({
      kind: "value",
      v: "pull_request",
    });
  });

  it("renders mixed text to a string, all or nothing", () => {
    expect(inputValue("ev-${{ github.event_name }}", {})).toEqual({
      kind: "value",
      v: "ev-pull_request",
    });
    expect(inputValue("ev-${{ needs.x.outputs.y }}", {})).toEqual({ kind: "unknown" });
  });

  it("stays unknown for an unresolvable whole expression", () => {
    expect(inputValue("${{ needs.x.outputs.y }}", {})).toEqual({ kind: "unknown" });
  });
});
