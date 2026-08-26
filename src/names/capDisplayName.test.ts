import { describe, expect, it } from "vitest";
import { capDisplayName } from "./capDisplayName.js";

describe("capDisplayName", () => {
  it("leaves a name at the limit alone", () => {
    const name = "x".repeat(100);
    expect(capDisplayName(name)).toBe(name);
  });

  it("cuts an overlong name to 97 characters plus an ellipsis", () => {
    const capped = capDisplayName("x".repeat(119));
    expect(capped).toBe(`${"x".repeat(97)}...`);
    expect(capped).toHaveLength(100);
  });
});
