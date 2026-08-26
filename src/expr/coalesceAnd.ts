import { truthy } from "./truthy.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * `A && B`. Short-circuits from either side: a falsy left decides it, and so
 * does a falsy right, because a truthy left would then yield the falsy right.
 * Only "left unknown, right not falsy" is genuinely undecided.
 */
export function coalesceAnd(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === false) return left;
  if (l === true) return right;
  return truthy(right) === false ? { kind: "falsy" } : UNKNOWN;
}
