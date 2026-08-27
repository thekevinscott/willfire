import { describe, expect, it } from "vitest";
import { negate } from "./negate.js";

describe("negate", () => {
  it("flips a decided answer", () => {
    expect(negate(true)).toBe(false);
    expect(negate(false)).toBe(true);
  });

  it("keeps an undecided one undecided", () => {
    expect(negate(null)).toBe(null);
  });
});
