import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";

/**
 * An `include:`/`exclude:` block: a literal list or an expression evaluating
 * to one. Absent means empty; anything unresolvable fails the expansion.
 */
export function comboList(v: unknown, scope: Scope): any[] | null {
  if (v === null || v === undefined) {
    return [];
  }
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v !== "string") {
    return null;
  }
  const val = evaluateValue(v, scope);
  if (val.kind !== "json" || !Array.isArray(val.v)) {
    return null;
  }
  return val.v;
}
