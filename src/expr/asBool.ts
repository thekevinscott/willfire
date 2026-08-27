import { UNKNOWN, type Val } from "./val.js";

export function asBool(b: boolean | null): Val {
  return b === null ? UNKNOWN : { kind: "value", v: b };
}
