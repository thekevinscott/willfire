import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";

/**
 * Render every `${{ }}` to literal text, or null when any cannot be settled —
 * a partial render would be a different program.
 */
export function renderTemplate(text: string, scope: Scope): string | null {
  let failed = false;
  const out = text.replace(/\$\{\{(.*?)\}\}/g, (whole, inner) => {
    const val = evaluateValue(String(inner), scope);
    if (val.kind !== "value") {
      // `out` is discarded once failed is set; any replacement works.
      failed = true;
      return whole;
    }
    return String(val.v);
  });
  return failed ? null : out;
}
