import { UNKNOWN, type Val } from "./val.js";

/**
 * `a[i]` on what `fromJSON` produced. GitHub yields `null` for a missing
 * index, which models as the empty string — the coercion GitHub applies.
 * Anything off that path is unknown, never a guess.
 */
export function indexVal(base: Val, idx: Val): Val {
  if (base.kind !== "json") return UNKNOWN;
  if (idx.kind !== "value") return UNKNOWN;
  let el: unknown;
  if (Array.isArray(base.v)) {
    if (typeof idx.v !== "number") return UNKNOWN;
    el = base.v[idx.v];
  } else {
    if (typeof idx.v !== "string") return UNKNOWN;
    el = base.v[idx.v];
  }
  if (el == null) return { kind: "value", v: "" };
  if (typeof el === "object") return { kind: "json", v: el as unknown[] };
  return { kind: "value", v: el as string | number | boolean };
}
