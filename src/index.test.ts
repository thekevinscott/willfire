import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("root barrel", () => {
  it("exposes exactly the published surface", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "evalIf",
      "expandMatrix",
      "expandWorkflowJobs",
      "isJobEntry",
      "isWorkflowEntry",
      "jobName",
      "makeOctokit",
      "matchFilters",
      "parseUses",
      "patternToRegex",
      "predict",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
