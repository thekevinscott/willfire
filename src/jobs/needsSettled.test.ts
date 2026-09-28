import { describe, expect, it } from "vitest";
import { needsSettled } from "./needsSettled.js";

describe("needsSettled", () => {
  it("settles a job with no needs as all-run", () => {
    expect(needsSettled([], {})).toBe("all-run");
  });

  it("settles as all-run when every need ran", () => {
    expect(needsSettled(["a", "b"], { a: "run", b: "run" })).toBe("all-run");
  });

  it("settles as some-skipped when any need skipped", () => {
    expect(needsSettled(["a", "b"], { a: "run", b: "skipped" })).toBe("some-skipped");
  });

  it("does not settle when a need is undecided", () => {
    expect(needsSettled(["a", "b"], { a: "skipped", b: "unknown" })).toBeUndefined();
    expect(needsSettled(["a"], { a: "unknown" })).toBeUndefined();
  });
});
