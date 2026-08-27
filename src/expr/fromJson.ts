import { UNKNOWN, type Val } from "./val.js";

export function fromJson(arg: Val): Val {
  if (arg.kind !== "value" || typeof arg.v !== "string") {
    return UNKNOWN;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(arg.v);
  } catch {
    return UNKNOWN;
  }
  if (parsed === null) {
    return { kind: "falsy" };
  }
  if (typeof parsed === "object") {
    return { kind: "json", v: parsed as unknown[] };
  }
  return { kind: "value", v: parsed as string | number | boolean };
}
