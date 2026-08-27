import { evaluateValue } from "./evaluateValue.js";
import { truthy } from "./truthy.js";
import type { Scope } from "./val.js";

export function evaluate(cond: string, scope: Scope = {}): boolean | null {
  return truthy(evaluateValue(cond, scope));
}
