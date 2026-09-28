import { describe, expect, it } from "vitest";
import { order } from "./order.js";
import type { Val } from "./val.js";

const S = (v: boolean): Val => ({ kind: "value", v });

describe("order", () => {
  it.each<[string, string | number, string | number, boolean]>([
    ["<", 1, 2, true],
    ["<", 2, 1, false],
    ["<=", 2, 2, true],
    ["<=", 3, 2, false],
    [">", 2, 1, true],
    [">", 1, 2, false],
    [">=", 2, 2, true],
    [">=", 1, 2, false],
    ["<", "a", "b", true],
    [">", "b", "a", true],
  ])("reads %s over %j and %j as %j", (op, a, b, want) => {
    expect(order(op, a, b)).toEqual(S(want));
  });

  it("reads every direction against NaN as false", () => {
    for (const op of ["<", "<=", ">", ">="]) {
      expect(order(op, Number.NaN, 0)).toEqual(S(false));
    }
  });
});
