import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("predict barrel", () => {
  it("exposes exactly the prediction pipeline", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "finalizePrediction",
      "makeOctokit",
      "predict",
      "sourceKey",
      "stackTargetRef",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
