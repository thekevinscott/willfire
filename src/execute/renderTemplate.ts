import { evaluateValue } from "../expr/evaluateValue.js";
import type { Scope } from "../expr/val.js";

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
