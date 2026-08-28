import { truthy } from "./truthy.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * Short-circuits from either side: a falsy right decides it too, because a
 * truthy left would then yield that falsy right.
 */
export function coalesceAnd(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === false) {
    return left;
  }
  if (l === true) {
    return right;
  }
  return truthy(right) === false ? { kind: "falsy" } : UNKNOWN;
}
