import { describe, expect, it } from "vitest";
import { rejectedIn } from "./rejectedIn.js";

describe("rejectedIn", () => {
  it("refuses secrets in a job guard, wrapped or bare", () => {
    expect(rejectedIn("${{ secrets.X != '' }}", "job")).toBe("secrets");
    expect(rejectedIn("secrets.X != ''", "job")).toBe("secrets");
  });

  it("refuses env in a job guard but allows it in a step guard", () => {
    expect(rejectedIn("${{ env.FOO != '' }}", "job")).toBe("env");
    expect(rejectedIn("${{ env.FOO != '' }}", "step")).toBeNull();
  });

  it("refuses secrets in a step guard", () => {
    expect(rejectedIn("${{ secrets.X }}", "step")).toBe("secrets");
  });

  it("allows the contexts a job guard may read", () => {
    expect(rejectedIn("github.actor == 'x' && vars.Y == inputs.z", "job")).toBeNull();
    expect(rejectedIn("needs.build.outputs.v == 'y'", "job")).toBeNull();
  });

  it("has nothing to answer for an absent guard", () => {
    expect(rejectedIn(undefined, "job")).toBeNull();
    expect(rejectedIn(null, "job")).toBeNull();
  });

  it("does not fire on a longer name that merely starts with a refused one", () => {
    expect(rejectedIn("envelope.x == 'y'", "job")).toBeNull();
  });
});
