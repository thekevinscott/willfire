import { UNKNOWN, type Val } from "./val.js";

/**
 * Wrap a decided answer as a concrete boolean value.
 *
 * Comparison, negation and the string functions all yield a real boolean, so
 * they produce a `value` — which keeps `!x == true` comparable. Only
 * short-circuiting produces the bare `truthy`/`falsy` points, because that is
 * the one case where truthiness is known and the value is not.
 */
export function asBool(b: boolean | null): Val {
  return b === null ? UNKNOWN : { kind: "value", v: b };
}
