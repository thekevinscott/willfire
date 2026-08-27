import { evaluate } from "../expr/evaluate.js";
import type { Scope } from "../expr/val.js";
import { prScope } from "./prScope.js";

/**
 * Return run|skipped|unknown for a job-level `if:`.
 *
 * `scope` carries the inputs the calling workflow passed down, and any job
 * outputs the caller knows. Without it a reusable workflow's guards are all
 * unknown, because every one of them is written against `inputs.*` or
 * `needs.*`.
 */
export function evalIf(cond: any, scope: Scope = {}): "run" | "skipped" | "unknown" {
  if (cond === null || cond === undefined) {
    return "run";
  }
  const verdict = evaluate(String(cond), prScope(scope));
  if (verdict === null) {
    return "unknown";
  }
  return verdict ? "run" : "skipped";
}
