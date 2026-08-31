import { describe, expect, expectTypeOf, it } from "vitest";
import type { DetailedCombo, Workflow } from "./types.js";

describe("the document types", () => {
  it("yields a document value on a read, not `any`", () => {
    const wf: Workflow = { on: { pull_request: null } };
    expectTypeOf(wf["on"]).not.toBeAny();
    expect(wf["on"]).toEqual({ pull_request: null });
  });

  it("carries a matrix combination as document values, not `any`", () => {
    const combo: DetailedCombo = { values: { os: "linux" }, displayKeys: ["os"] };
    expectTypeOf(combo.values["os"]).not.toBeAny();
    expect(combo.values["os"]).toBe("linux");
  });
});
