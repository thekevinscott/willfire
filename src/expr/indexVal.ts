import { UNKNOWN, type Val } from "./val.js";

export function indexVal(base: Val, idx: Val): Val {
  if (base.kind !== "json") {
    return UNKNOWN;
  }
  if (idx.kind !== "value") {
    return UNKNOWN;
  }
  let el: unknown;
  if (Array.isArray(base.v)) {
    if (typeof idx.v !== "number") {
      return UNKNOWN;
    }
    el = base.v[idx.v];
  } else {
    if (typeof idx.v !== "string") {
      return UNKNOWN;
    }
    el = base.v[idx.v];
  }
  if (el == null) {
    return { kind: "value", v: "" };
  }
  if (typeof el === "object") {
    return { kind: "json", v: el as unknown[] };
  }
  return { kind: "value", v: el as string | number | boolean };
}
