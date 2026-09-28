import { describe, expect, it } from "vitest";
import { ifExpressions } from "./ifExpressions.js";

describe("ifExpressions", () => {
  it("reads a bare condition as one expression", () => {
    expect(ifExpressions("secrets.X != ''")).toEqual(["secrets.X != ''"]);
  });

  it("strips the wrapper", () => {
    expect(ifExpressions("${{ github.ref == 'refs/heads/main' }}")).toEqual([
      " github.ref == 'refs/heads/main' ",
    ]);
  });

  it("returns every body of an interpolated value", () => {
    expect(ifExpressions("a-${{ x.y }}-b-${{ z }}")).toEqual([" x.y ", " z "]);
  });

  it("keeps a multi-line body together", () => {
    expect(ifExpressions("${{ a\n&& b }}")).toEqual([" a\n&& b "]);
  });
});
