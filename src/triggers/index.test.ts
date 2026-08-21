import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("triggers barrel", () => {
  it("exposes exactly the trigger helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual(["MISSING", "getPrTrigger", "workflowDispatches"]);
    expect(typeof barrel.getPrTrigger).toBe("function");
    expect(typeof barrel.workflowDispatches).toBe("function");
    expect(typeof barrel.MISSING).toBe("symbol");
  });
});
