import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the expr barrel", () => {
  it("exports exactly the evaluator's public surface", () => {
    // Type-only exports have no runtime presence; this pins the value exports.
    expect(Object.keys(barrel).sort()).toEqual(["UNKNOWN", "evaluate", "evaluateValue"]);
    expect(typeof barrel.evaluate).toBe("function");
    expect(typeof barrel.evaluateValue).toBe("function");
    expect(barrel.UNKNOWN).toEqual({ kind: "unknown" });
  });
});
