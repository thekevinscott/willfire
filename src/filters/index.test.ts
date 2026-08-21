import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("filters barrel", () => {
  it("exposes exactly the filter helpers", () => {
    expect(Object.keys(barrel).sort()).toEqual(["matchFilters", "patternToRegex"]);
    for (const fn of Object.values(barrel)) expect(typeof fn).toBe("function");
  });
});
