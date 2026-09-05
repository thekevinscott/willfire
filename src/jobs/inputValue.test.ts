import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateValue } from "../expr/evaluateValue.js";
import { renderTemplate } from "../execute/renderTemplate.js";
import { inputValue } from "./inputValue.js";

// Spies over the real modules: which collaborator a value is handed to, and in
// what form, is part of what this suite pins.
vi.mock("../expr/evaluateValue.js", async () => {
  const actual =
    await vi.importActual<typeof import("../expr/evaluateValue.js")>("../expr/evaluateValue.js");
  return { ...actual, evaluateValue: vi.fn(actual.evaluateValue) };
});
vi.mock("../execute/renderTemplate.js", async () => {
  const actual =
    await vi.importActual<typeof import("../execute/renderTemplate.js")>(
      "../execute/renderTemplate.js",
    );
  return { ...actual, renderTemplate: vi.fn(actual.renderTemplate) };
});

describe("inputValue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("keeps a string with no expression as itself, never rendering it", () => {
    expect(inputValue("plain", {})).toEqual({ kind: "value", v: "plain" });
    expect(vi.mocked(renderTemplate)).not.toHaveBeenCalled();
  });

  it("evaluates a whole-expression value, keeping its type", () => {
    expect(inputValue("${{ github.event_name }}", {})).toEqual({
      kind: "value",
      v: "pull_request",
    });
    // The body reaches the evaluator, not the `${{ }}` wrapped around it.
    expect(vi.mocked(evaluateValue)).toHaveBeenCalledWith(" github.event_name ", {
      github: { event_name: "pull_request" },
    });
  });

  it("trims before deciding a value is one whole expression", () => {
    expect(inputValue("  ${{ github.event_name }}  ", {})).toEqual({
      kind: "value",
      v: "pull_request",
    });
  });

  it("renders mixed text to a string, all or nothing", () => {
    expect(inputValue("ev-${{ github.event_name }}", {})).toEqual({
      kind: "value",
      v: "ev-pull_request",
    });
    expect(inputValue("${{ github.event_name }}-${{ github.event_name }}", {})).toEqual({
      kind: "value",
      v: "pull_request-pull_request",
    });
    expect(inputValue("ev-${{ needs.x.outputs.y }}", {})).toEqual({ kind: "unknown" });
  });

  it("stays unknown for an unresolvable whole expression", () => {
    expect(inputValue("${{ needs.x.outputs.y }}", {})).toEqual({ kind: "unknown" });
  });
});
