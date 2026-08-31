import { describe, expect, it } from "vitest";
import { lookup } from "./lookup.js";
import type { Scope } from "./val.js";

const SCOPE: Scope = {
  inputs: { mode: { kind: "value", v: "fast" } },
  github: { event_name: "pull_request" },
  needs: { detect: { outputs: { x: "y" } } },
  steps: { scan: { outputs: { x: "y" } } },
};

describe("lookup", () => {
  it("leaves a bare name unknown", () => {
    expect(lookup(SCOPE, "something")).toEqual({ kind: "unknown" });
  });

  it("resolves inputs and leaves absent ones unknown", () => {
    expect(lookup(SCOPE, "inputs.mode")).toEqual({ kind: "value", v: "fast" });
    expect(lookup(SCOPE, "inputs.other")).toEqual({ kind: "unknown" });
    expect(lookup({}, "inputs.mode")).toEqual({ kind: "unknown" });
  });

  it("resolves github values and leaves absent ones unknown", () => {
    expect(lookup(SCOPE, "github.event_name")).toEqual({ kind: "value", v: "pull_request" });
    expect(lookup(SCOPE, "github.ref")).toEqual({ kind: "unknown" });
    expect(lookup({}, "github.ref")).toEqual({ kind: "unknown" });
  });

  it("models only needs.<job>.outputs.<name>", () => {
    expect(lookup(SCOPE, "needs.detect.outputs.x")).toEqual({ kind: "value", v: "y" });
    // A supplied job's missing output is the empty string, per the
    // complete-set contract; an unsupplied job stays unknown.
    expect(lookup(SCOPE, "needs.detect.outputs.missing")).toEqual({ kind: "value", v: "" });
    expect(lookup(SCOPE, "needs.other.outputs.x")).toEqual({ kind: "unknown" });
    expect(lookup(SCOPE, "needs.detect.result")).toEqual({ kind: "unknown" });
    expect(lookup({}, "needs.detect.outputs.x")).toEqual({ kind: "unknown" });
    // An empty needs map behaves like an absent one.
    expect(lookup({ needs: {} }, "needs.detect.outputs.x")).toEqual({ kind: "unknown" });
  });

  it("models steps the same way", () => {
    expect(lookup(SCOPE, "steps.scan.outputs.x")).toEqual({ kind: "value", v: "y" });
    expect(lookup(SCOPE, "steps.scan.outputs.missing")).toEqual({ kind: "value", v: "" });
    expect(lookup(SCOPE, "steps.other.outputs.x")).toEqual({ kind: "unknown" });
    expect(lookup(SCOPE, "steps.scan.outcome")).toEqual({ kind: "unknown" });
    expect(lookup({}, "steps.scan.outputs.x")).toEqual({ kind: "unknown" });
    expect(lookup({ steps: {} }, "steps.scan.outputs.x")).toEqual({ kind: "unknown" });
  });

  it("resolves matrix only when a combination was supplied", () => {
    // A job `if:` is evaluated before the matrix expands, so no combination
    // reaches it and `matrix.*` stays unknown there.
    expect(lookup(SCOPE, "matrix.language")).toEqual({ kind: "unknown" });
    expect(lookup({ matrix: { language: "go" } }, "matrix.language")).toEqual({
      kind: "value",
      v: "go",
    });
  });

  it("leaves every runtime context unknown", () => {
    expect(lookup(SCOPE, "env.FOO")).toEqual({ kind: "unknown" });
    // A supplied combination is not a fallback for another context's key.
    expect(lookup({ matrix: { FOO: "x" } }, "env.FOO")).toEqual({ kind: "unknown" });
  });
});
