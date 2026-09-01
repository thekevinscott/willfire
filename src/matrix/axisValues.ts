import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";
import type { YamlValue } from "../yamlValue.js";

/**
 * The values of one matrix axis, or null when they cannot be known.
 *
 * A plain list is itself. An axis written as an expression —
 * `language: ${{ fromJSON(needs.detect.outputs.coverage_languages) }}` — is
 * the values another job computed, and is knowable exactly when the scope
 * carries that job's outputs. Anything else stays null, which is what makes
 * the whole job `unknown` rather than a guess at how many checks it creates.
 */
export function axisValues(v: unknown, scope: Scope): YamlValue[] | null {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v !== "string") {
    return null;
  }
  const val = evaluateValue(v, scope);
  return Array.isArray(val.v) ? val.v : null;
}
