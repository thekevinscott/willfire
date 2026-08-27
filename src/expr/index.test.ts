import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the expr barrel", () => {
  it("exports exactly the evaluator's public surface", () => {
    expect(Object.keys(barrel).sort()).toEqual(["UNKNOWN", "evaluate", "evaluateValue"]);
    expect(typeof barrel.evaluate).toBe("function");
    expect(typeof barrel.evaluateValue).toBe("function");
    expect(barrel.UNKNOWN).toEqual({ kind: "unknown" });
  });
});
