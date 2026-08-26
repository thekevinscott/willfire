import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import { renderTemplate } from "./renderTemplate.js";

/**
 * Caller's `with:` over declared defaults, everything a string — action inputs
 * are untyped, and an unset input is the empty string. An unrenderable value
 * stays unknown; it only fails if a step reads it.
 */
export function bindActionInputs(
  action: any,
  withBlock: unknown,
  scope: Scope,
): Record<string, Val> {
  const bind = (raw: unknown): Val => {
    if (raw == null) return { kind: "value", v: "" };
    if (typeof raw === "boolean" || typeof raw === "number") {
      return { kind: "value", v: String(raw) };
    }
    const rendered = renderTemplate(String(raw), scope);
    return rendered == null ? UNKNOWN : { kind: "value", v: rendered };
  };
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(action?.inputs ?? {})) {
    out[name] =
      decl != null && typeof decl === "object" && "default" in decl
        ? bind((decl as Record<string, unknown>)["default"])
        : { kind: "value", v: "" };
  }
  if (withBlock != null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries(withBlock as Record<string, unknown>)) {
      out[name] = bind(raw);
    }
  }
  return out;
}
