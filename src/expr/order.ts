import { asBool } from "./asBool.js";
import type { Val } from "./val.js";

/** The four ordering operators, over two sides already reduced to one type. */
export function order(op: string, a: string | number, b: string | number): Val {
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
