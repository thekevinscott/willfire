import { describe, expect, it } from "vitest";
import { toNumber } from "./toNumber.js";

describe("toNumber", () => {
  it.each<[string | number | boolean, number]>([
    [3, 3],
    [true, 1],
    [false, 0],
    ["", 0],
    ["  ", 0],
    ["1", 1],
    ["0x1f", 31],
  ])("casts %j to %j", (v, want) => {
    expect(toNumber(v)).toBe(want);
  });

  it("casts a string that is not a number to NaN", () => {
    expect(toNumber("abc")).toBeNaN();
    expect(toNumber("true")).toBeNaN();
  });
});
