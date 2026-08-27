import { describe, expect, it } from "vitest";
import { isPrEventAction } from "./isPrEventAction.js";

describe("isPrEventAction", () => {
  it("accepts exactly the PR actions a prediction understands", () => {
    expect(isPrEventAction("opened")).toBe(true);
    expect(isPrEventAction("synchronize")).toBe(true);
    expect(isPrEventAction("reopened")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isPrEventAction("closed")).toBe(false);
    expect(isPrEventAction("")).toBe(false);
  });
});
