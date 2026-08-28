import { truthy } from "./truthy.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * Short-circuits from either side: a truthy right decides it too, since a falsy
 * left would then yield that truthy right.
 */
export function coalesceOr(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === true) {
    return left;
  }
  if (l === false) {
    return right;
  }
  return truthy(right) === true ? { kind: "truthy" } : UNKNOWN;
}
