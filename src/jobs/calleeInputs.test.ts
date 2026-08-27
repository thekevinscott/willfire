import { describe, expect, it, vi } from "vitest";
import { calleeInputs } from "./calleeInputs.js";
import type { YamlMap } from "../yamlValue.js";

// The isolation gate wants collaborators mocked; the caller-over-defaults
// contract is what this suite pins, so the mocks pass the real modules
// through.
vi.mock(
  "./inputValue.js",
  async () => await vi.importActual<typeof import("./inputValue.js")>("./inputValue.js"),
);
vi.mock(
  "./workflowCallInputs.js",
  async () =>
    await vi.importActual<typeof import("./workflowCallInputs.js")>("./workflowCallInputs.js"),
);

const callee = (inputs: YamlMap) => ({ on: { workflow_call: { inputs } } });

describe("calleeInputs", () => {
  it("takes what the caller passed over the callee's default", () => {
    expect(calleeInputs({ lang: "rust" }, callee({ lang: { default: "ts" } }), {})).toEqual({
      lang: { kind: "value", v: "rust" },
    });
  });

  it("falls back to the declared default when the caller omits an input", () => {
    expect(calleeInputs({}, callee({ lang: { default: "ts" } }), {})).toEqual({
      lang: { kind: "value", v: "ts" },
    });
  });

  it("leaves a declared input with no default and no caller value unknown", () => {
    expect(calleeInputs(undefined, callee({ lang: {} }), {})).toEqual({
      lang: { kind: "unknown" },
    });
    expect(calleeInputs(undefined, callee({ lang: null }), {})).toEqual({
      lang: { kind: "unknown" },
    });
  });

  it("ignores a with: block that is not a mapping", () => {
    const wf = callee({ lang: { default: "ts" } });
    expect(calleeInputs(null, wf, {})).toEqual({ lang: { kind: "value", v: "ts" } });
    // Without the object guard a string `with:` would enumerate as characters.
    expect(calleeInputs("lang", wf, {})).toEqual({ lang: { kind: "value", v: "ts" } });
  });

  it("evaluates a caller value in the caller's scope", () => {
    const scope = { needs: { d: { outputs: { lang: "rust" } } } };
    expect(calleeInputs({ lang: "${{ needs.d.outputs.lang }}" }, callee({}), scope)).toEqual({
      lang: { kind: "value", v: "rust" },
    });
  });
});
