import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("uses barrel", () => {
  it("exposes exactly the uses parser", () => {
    expect(Object.keys(barrel).sort()).toEqual(["parseUses"]);
    expect(typeof barrel.parseUses).toBe("function");
  });
});
