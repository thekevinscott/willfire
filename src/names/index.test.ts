import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("names barrel", () => {
  it("exposes exactly the naming helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "EXPRESSION_RE",
      "jobDisplayName",
      "renderName",
      "skippedDisplayName",
    ]);
    expect(barrel.EXPRESSION_RE).toBeInstanceOf(RegExp);
    expect(typeof barrel.jobDisplayName).toBe("function");
    expect(typeof barrel.renderName).toBe("function");
    expect(typeof barrel.skippedDisplayName).toBe("function");
  });
});
