import { evaluateValue } from "./evaluateValue.js";
import { truthy } from "./truthy.js";
import type { Scope } from "./val.js";

/** Evaluate a condition to a truthiness, or null when it cannot be settled. */
export function evaluate(cond: string, scope: Scope = {}): boolean | null {
  return truthy(evaluateValue(cond, scope));
}
