import { UNKNOWN, type Val } from "./val.js";

/**
 * `fromJSON(s)` on a known string.
 *
 * The result is sorted into the lattice rather than dropped in whole: a scalar
 * is an ordinary value and stays comparable, `null` has a known truthiness and
 * no useful value, and only an array or an object needs the `json` point.
 * Anything unparseable is unknown — a workflow that reaches this at runtime
 * fails, and predicting a failure is not this function's job.
 */
export function fromJson(arg: Val): Val {
  if (arg.kind !== "value" || typeof arg.v !== "string") return UNKNOWN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(arg.v);
  } catch {
    return UNKNOWN;
  }
  if (parsed === null) return { kind: "falsy" };
  if (typeof parsed === "object") return { kind: "json", v: parsed as unknown[] };
  return { kind: "value", v: parsed as string | number | boolean };
}
