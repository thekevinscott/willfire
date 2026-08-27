import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("entries barrel", () => {
  it("exposes exactly the entry helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual(["isJobEntry", "isWorkflowEntry", "jobName"]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
