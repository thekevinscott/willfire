import { describe, expect, expectTypeOf, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { evalIf } from "./evalIf.js";

describe("evalIf", () => {
  it("takes an undecided condition, not `any`", () => {
    expectTypeOf(evalIf).parameter(0).not.toBeAny();
  });

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

  it("coerces a non-string condition before evaluating", () => {
    // A falsy condition still goes through the evaluator: only an absent `if:`
    // takes the early return.
    expect(evalIf(false)).toBe("skipped");
    expect(evalIf(0)).toBe("skipped");
    expect(evalIf(1)).toBe("run");
  });

  it("resolves against the scope the caller handed in", () => {
    // The scope param is the expr module's own Scope, not a structural copy.
    const hit: Scope = { inputs: { x: { kind: "value", v: "v" } } };
    const miss: Scope = { inputs: { x: { kind: "value", v: "w" } } };
    expect(evalIf("inputs.x == 'v'", hit)).toBe("run");
    expect(evalIf("inputs.x == 'v'", miss)).toBe("skipped");
  });
});
