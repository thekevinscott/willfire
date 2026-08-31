/**
 * A tri-state evaluator for the slice of GitHub expressions that job `if:`
 * conditions use. Two rules carry the module:
 *
 * 1. Truthiness can be known when the value is not — `A && B` with an unknown
 *    `A` and a false `B` is false either way. So the lattice has four points,
 *    not three: a concrete value, known-truthy, known-falsy, nothing at all.
 * 2. Unrecognized is unknown, never a guess. An unparseable condition, an
 *    unsupported function, an unmodelled comparison all collapse to `unknown`.
 */
import { evaluateValue } from "./evaluateValue.js";
import { truthy } from "./truthy.js";
import type { Scope } from "./val.js";

export function evaluate(cond: string, scope: Scope = {}): boolean | null {
  return truthy(evaluateValue(cond, scope));
}
