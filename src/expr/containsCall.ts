import { asBool } from "./asBool.js";
import { compare } from "./compare.js";
import { UNKNOWN, type Val } from "./val.js";

/**
 * Over an array `contains` asks whether any element equals the needle under the
 * same loose equality `==` uses, not whether any element has it as a substring:
 * probe #383 run 36431899958 skipped `contains(fromJSON('["abc"]'), 'ab')` and
 * ran `contains(fromJSON('[1,2]'), '1')`. An element that is itself an array,
 * an object or null is not modelled.
 */
export function containsCall(hay: Val, needle: Val): Val {
  if (needle.kind !== "value") {
    return UNKNOWN;
  }
  if (hay.kind === "json") {
    if (!Array.isArray(hay.v)) {
      return UNKNOWN;
    }
    for (const el of hay.v) {
      if (typeof el !== "string" && typeof el !== "number" && typeof el !== "boolean") {
        return UNKNOWN;
      }
      const eq = compare("==", { kind: "value", v: el }, needle);
      if (eq.kind === "value" && eq.v === true) {
        return asBool(true);
      }
    }
    return asBool(false);
  }
  if (hay.kind !== "value") {
    return UNKNOWN;
  }
  if (typeof hay.v !== "string" || typeof needle.v !== "string") {
    return UNKNOWN;
  }
  return asBool(hay.v.includes(needle.v));
}
