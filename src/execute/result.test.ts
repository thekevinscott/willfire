import { describe, expect, it } from "vitest";
import { err, type Res } from "./result.js";

describe("err", () => {
  it("wraps a reason as the failure arm of Res", () => {
    const r: Res<string> = err("nope");
    expect(r).toEqual({ ok: false, reason: "nope" });
  });
});
