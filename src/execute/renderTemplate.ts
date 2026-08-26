import { evaluateValue, type Scope } from "../expr.js";

/**
 * Render every `${{ }}` to literal text, or null when any cannot be settled —
 * a partial render would be a different program.
 */
export function renderTemplate(text: string, scope: Scope): string | null {
  let failed = false;
  const out = text.replace(/\$\{\{(.*?)\}\}/g, (_whole, inner) => {
    const val = evaluateValue(String(inner), scope);
    if (val.kind !== "value") {
      failed = true;
      return "";
    }
    return String(val.v);
  });
  return failed ? null : out;
}
