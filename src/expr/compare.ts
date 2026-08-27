import { asBool } from "./asBool.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * Comparison, deliberately narrow: both sides must be concrete and of the same
 * primitive type.
 *
 * GitHub coerces across types when it compares, and the corner cases are
 * genuinely surprising (`'' == 0` is true). Every comparison that matters in
 * practice is string-to-string — `inputs.gates == ''`,
 * `github.event_name == 'pull_request'` — so modelling the coercion table
 * would add risk without adding reach. Mixed types return unknown.
 */
export function compare(op: string, left: Val, right: Val): Val {
  // GitHub compares arrays and objects by instance, and two written sides are
  // never the same instance: `==` is false, `!=` is true, ordering unknowable.
  if (left.kind === "json" || right.kind === "json") {
    if (op === "==") {
      return asBool(false);
    }
    if (op === "!=") {
      return asBool(true);
    }
    return UNKNOWN;
  }
  if (left.kind !== "value" || right.kind !== "value") {
    return UNKNOWN;
  }
  const a = left.v;
  const b = right.v;
  if (typeof a !== typeof b) {
    return UNKNOWN;
  }
  if (op === "==") {
    return asBool(a === b);
  }
  if (op === "!=") {
    return asBool(a !== b);
  }
  // Ordering on booleans is not modelled. GitHub coerces them to numbers, and
  // the answer is never one a workflow author meant to ask for.
  if (typeof a === "boolean" || typeof b === "boolean") {
    return UNKNOWN;
  }
  if (op === "<") {
    return asBool(a < b);
  }
  if (op === "<=") {
    return asBool(a <= b);
  }
  if (op === ">") {
    return asBool(a > b);
  }
  return asBool(a >= b);
}
