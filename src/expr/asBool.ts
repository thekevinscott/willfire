import { UNKNOWN, type Val } from "./val.js";

/**
 * A `value`, not a bare `truthy`/`falsy`, so `!x == true` stays comparable.
 * Short-circuiting is the only producer of those points: it is the one case
 * where truthiness is known and the value is not.
 */
export function asBool(b: boolean | null): Val {
  return b === null ? UNKNOWN : { kind: "value", v: b };
}
