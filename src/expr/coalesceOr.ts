import { truthy } from "./truthy.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * `A || B`. The mirror image: a truthy left decides it, and so does a truthy
 * right, since a falsy left would then yield the truthy right.
 */
export function coalesceOr(left: Val, right: Val): Val {
  const l = truthy(left);
  if (l === true) return left;
  if (l === false) return right;
  return truthy(right) === true ? { kind: "truthy" } : UNKNOWN;
}
