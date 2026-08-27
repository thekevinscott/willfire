import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import { renderTemplate } from "./renderTemplate.js";

/**
 * What `inputs.*` means inside a composite action: the caller's `with:`
 * values over the action's declared defaults, everything a string — action
 * inputs are untyped, and an input nobody set is the empty string, not a
 * hole. A value whose `${{ }}` cannot be rendered stays unknown rather than
 * failing here: it only matters if a step actually reads it, and the read is
 * where that failure is honest.
 */
export function bindActionInputs(
  action: any,
  withBlock: unknown,
  scope: Scope,
): Record<string, Val> {
  const bind = (raw: unknown): Val => {
    if (raw == null) {
      return { kind: "value", v: "" };
    }
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
