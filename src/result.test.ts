import { describe, expect, it } from "vitest";
import { err } from "./result.js";

describe("err", () => {
  it("wraps a reason as a failed Res", () => {
    expect(err("boom")).toEqual({ ok: false, reason: "boom" });
  });

  it("carries its own reason per call", () => {
    const a = err("a");
    const b = err("b");
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("a");
    expect(b.reason).toBe("b");
  });
});
