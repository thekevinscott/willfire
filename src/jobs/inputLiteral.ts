import { UNKNOWN, type Val } from "../expr/val.js";

export function inputLiteral(raw: unknown): Val {
  if (raw == null) {
    return { kind: "value", v: "" };
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return { kind: "value", v: raw };
  }
  if (typeof raw === "string") {
    return raw.includes("${{") ? UNKNOWN : { kind: "value", v: raw };
  }
  return UNKNOWN;
}
