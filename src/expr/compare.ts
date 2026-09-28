import { asBool } from "./asBool.js";
import { order } from "./order.js";
import { toNumber } from "./toNumber.js";
import { UNKNOWN, type Val } from "./val.js";

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
    const x = toNumber(a);
    const y = toNumber(b);
    if (op === "==") {
      return asBool(x === y);
    }
    if (op === "!=") {
      return asBool(x !== y);
    }
    return order(op, x, y);
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
  return order(op, a, b);
}
