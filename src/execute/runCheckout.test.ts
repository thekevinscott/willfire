import { describe, expect, it } from "vitest";
import { runCheckout } from "./runCheckout.js";
import type { WalkCtx } from "./walkCtx.js";

const ctx = (hasHistory: boolean): WalkCtx => ({ hasHistory }) as WalkCtx;

describe("runCheckout", () => {
  it("is already satisfied when bare, or with an empty with:", () => {
    expect(runCheckout({}, "step '#1'", ctx(false))).toEqual({ ok: true, v: {} });
    expect(runCheckout({ with: {} }, "step '#1'", ctx(false))).toEqual({ ok: true, v: {} });
  });

  it("accepts fetch-depth: 0 only when the workspace has history", () => {
    const step = { with: { "fetch-depth": 0 } };
    expect(runCheckout(step, "step '#1'", ctx(true))).toEqual({ ok: true, v: {} });
    expect(runCheckout(step, "step '#1'", ctx(false))).toEqual({
      ok: false,
      reason: "step '#1': checkout wants history the workspace does not have",
    });
  });

  it("refuses any other input", () => {
    for (const withBlock of [{ ref: "main" }, { "fetch-depth": 1 }, { "fetch-depth": 0, ref: "main" }]) {
      expect(runCheckout({ with: withBlock }, "step '#1'", ctx(true))).toEqual({
        ok: false,
        reason: "step '#1': actions/checkout with inputs is not modelled",
      });
    }
  });
});
