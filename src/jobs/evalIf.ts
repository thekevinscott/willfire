import { evaluate } from "../expr/evaluate.js";
import type { Scope } from "../expr/val.js";
import { prScope } from "./prScope.js";

export function evalIf(cond: any, scope: Scope = {}): "run" | "skipped" | "unknown" {
  if (cond == null) {
    return "run";
  }
  const verdict = evaluate(String(cond), prScope(scope));
  if (verdict === null) {
    return "unknown";
  }
  return verdict ? "run" : "skipped";
}
