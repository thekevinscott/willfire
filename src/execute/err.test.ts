import { describe, expect, it } from "vitest";
import { err } from "./err.js";

describe("err", () => {
  it("wraps a reason as a failed Res", () => {
    expect(err("boom")).toEqual({ ok: false, reason: "boom" });
  });
});
