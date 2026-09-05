import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";
import type { YamlMap } from "../yamlValue.js";
import { interpolateValue } from "./interpolateValue.js";

/**
 * An `include:`/`exclude:` block: a literal list or an expression evaluating
 * to one. Absent means empty; anything unresolvable fails the expansion.
 */
export function comboList(v: unknown, scope: Scope): YamlMap[] | null {
  if (v === null || v === undefined) {
    return [];
  }
  if (Array.isArray(v)) {
    const interpolated = interpolateValue(v, scope);
    return interpolated === null ? null : (interpolated.v as YamlMap[]);
  }
  if (typeof v !== "string") {
    return null;
  }
  const val = evaluateValue(v, scope);
  return Array.isArray(val.v) ? (val.v as YamlMap[]) : null;
}
