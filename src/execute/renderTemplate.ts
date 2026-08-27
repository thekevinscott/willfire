import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";

/**
 * Render every `${{ }}` in a template to its literal text, or null when any
 * of them cannot be settled. Null rather than a partial render: a script with
 * a hole in it is a different program, and running a different program is the
 * exact lie rule 2 exists to prevent.
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
