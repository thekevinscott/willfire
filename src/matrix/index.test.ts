import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("matrix barrel", () => {
  it("exposes exactly the matrix helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "expandMatrix",
      "expandMatrixDetailed",
      "formatMatrixValue",
      "matrixSuffix",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
