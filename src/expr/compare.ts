import { asBool } from "./asBool.js";
import { UNKNOWN, type Val } from "./val.js";

export function compare(op: string, left: Val, right: Val): Val {
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
