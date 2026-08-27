import { describe, expect, it } from "vitest";
import { err } from "./err.js";

describe("err", () => {
  it("wraps a reason in a failed Res", () => {
    expect(err("nope")).toEqual({ ok: false, reason: "nope" });
  });
});
