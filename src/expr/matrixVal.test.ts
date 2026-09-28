import { describe, expect, it } from "vitest";
import { matrixVal } from "./matrixVal.js";

describe("matrixVal", () => {
  it("reads a scalar axis", () => {
    expect(matrixVal({ os: "linux" }, "os")).toEqual({ kind: "value", v: "linux" });
    expect(matrixVal({ node: 20 }, "node")).toEqual({ kind: "value", v: 20 });
  });

  it("walks into a structured axis value", () => {
    expect(matrixVal({ cfg: { os: "linux" } }, "cfg.os")).toEqual({ kind: "value", v: "linux" });
  });

  it("hands back a structured value as json", () => {
    expect(matrixVal({ cfg: { os: "linux" } }, "cfg")).toEqual({
      kind: "json",
      v: { os: "linux" },
    });
    expect(matrixVal({ tags: ["a", "b"] }, "tags")).toEqual({ kind: "json", v: ["a", "b"] });
  });

  it("reads an explicit null as the empty string", () => {
    expect(matrixVal({ os: null }, "os")).toEqual({ kind: "value", v: "" });
  });

  it("reads an axis the combination does not carry as the empty string", () => {
    // Probe PR #372 run 36431257532: `build ${{ matrix.label }}` over a
    // combination with no `label` dispatched as `build`.
    expect(matrixVal({ os: "linux" }, "nope")).toEqual({ kind: "value", v: "" });
    expect(matrixVal({ cfg: { os: "linux" } }, "cfg.nope")).toEqual({ kind: "value", v: "" });
  });

  it("leaves everything unknown with no combination at all", () => {
    expect(matrixVal(undefined, "os")).toEqual({ kind: "unknown" });
  });
});
