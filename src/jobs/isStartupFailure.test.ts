import { describe, expect, it } from "vitest";
import { isStartupFailure } from "./isStartupFailure.js";

describe("isStartupFailure", () => {
  it("recognises its own", () => {
    expect(isStartupFailure(Object.assign(new Error("boom"), { startupFailure: true }))).toBe(true);
  });

  it("does not claim an ordinary error", () => {
    // Load-bearing: a 503 from the API must keep propagating rather than
    // collapse a workflow to zero checks.
    expect(isStartupFailure(new Error("503 from contents"))).toBe(false);
  });

  it("does not claim a plain object wearing the tag", () => {
    expect(isStartupFailure({ startupFailure: true })).toBe(false);
  });
});
