import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";

/**
 * A literal matrix value with its `${{ }}` evaluated, or null when it cannot be.
 *
 * Probe PR #14: GitHub interpolates a matrix value at expansion time, and the
 * interpolated text is what reaches the check name — `axis-expr (pull_request)`,
 * never `axis-expr (${{ github.event_name }})`. Interpolation reaches inside
 * lists and maps, so an `include:` entry's values get it too.
 *
 * The result is boxed because null is itself a value a matrix can hold.
 */
export function interpolateValue(v: YamlValue, scope: Scope): { v: YamlValue } | null {
  if (Array.isArray(v)) {
    const out: YamlValue[] = [];
    for (const el of v) {
      const r = interpolateValue(el, scope);
      if (r === null) {
        return null;
      }
      out.push(r.v);
    }
    return { v: out };
  }
  if (v !== null && typeof v === "object") {
    const out: YamlMap = {};
    for (const [k, el] of Object.entries(v as Record<string, YamlValue>)) {
      const r = interpolateValue(el, scope);
      if (r === null) {
        return null;
      }
      out[k] = r.v;
    }
    return { v: out };
  }
  if (typeof v !== "string" || !v.includes("${{")) {
    return { v };
  }
  const val = evaluateValue(v, scope);
  if (val.kind !== "value" && val.kind !== "json") {
    return null;
  }
  return { v: val.v };
}
