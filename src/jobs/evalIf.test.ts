import { describe, expect, it } from "vitest";
import { evalIf } from "./evalIf.js";

describe("evalIf", () => {
  it.each([
    [undefined, "run"],
    [null, "run"],
    ["true", "run"],
    ["True", "run"],
    ["always()", "run"],
    ["${{ always() }}", "run"],
    ["false", "skipped"],
    ["False", "skipped"],
    ["${{ false }}", "skipped"],
    ["github.event_name == 'pull_request'", "run"],
    ["github.event_name != 'pull_request'", "skipped"],
    ["github.event_name == 'push'", "skipped"],
    ["github.event_name != 'push'", "run"],
    ["github.ref == 'refs/heads/main'", "unknown"],
  ] as const)("reads %s as %s", (cond, expected) => {
    expect(evalIf(cond)).toBe(expected);
  });

  it("resolves against the scope the caller handed in", () => {
    expect(evalIf("inputs.x == 'v'", { inputs: { x: { kind: "value", v: "v" } } })).toBe("run");
    expect(evalIf("inputs.x == 'v'", { inputs: { x: { kind: "value", v: "w" } } })).toBe(
      "skipped",
    );
  });
});
