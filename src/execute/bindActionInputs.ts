import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";
import { renderTemplate } from "./renderTemplate.js";
import type { ActionModel } from "./types.js";

/**
 * Caller's `with:` over declared defaults, everything a string — action inputs
 * are untyped, and an unset input is the empty string. An unrenderable value
 * stays unknown; it only fails if a step reads it.
 */
export function bindActionInputs(
  action: ActionModel,
  withBlock: YamlValue | undefined,
  scope: Scope,
): Record<string, Val> {
  const bind = (raw: YamlValue | undefined): Val => {
    if (raw === null || raw === undefined) {
      return { kind: "value", v: "" };
    }
    // Booleans and numbers stringify template-free, so the render is a no-op.
    const rendered = renderTemplate(String(raw), scope);
    return rendered === null ? UNKNOWN : { kind: "value", v: rendered };
  };
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(action?.inputs ?? {})) {
    // An input declared without a `default:` binds the same empty string a
    // missing declaration does, so the two cases share one path.
    out[name] = bind((decl as YamlMap | null)?.["default"]);
  }
  if (withBlock !== null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries<YamlValue | undefined>(withBlock)) {
      out[name] = bind(raw);
    }
  }
  return out;
}
