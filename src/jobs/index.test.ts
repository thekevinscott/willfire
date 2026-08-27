import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("jobs barrel", () => {
  it("exposes exactly the expansion helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "evalIf",
      "expandJobs",
      "expandWorkflowJobs",
      "prScope",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
