import { formatMatrixValue } from "../matrix/formatMatrixValue.js";
import { lookupPath } from "./lookupPath.js";
import type { Combo, Rendered } from "../types.js";

export function renderName(template: string, combo: Combo): Rendered {
  let resolved = true;
  const text = template.replace(/\$\{\{(.*?)\}\}/g, (whole, inner) => {
    const expr = String(inner).trim();
    if (expr.startsWith("matrix.")) {
      if (!combo) {
        resolved = false;
        return whole;
      }
      const val = lookupPath(combo, expr.slice("matrix.".length));
      if (val === undefined) {
        resolved = false;
        return whole;
      }
      return formatMatrixValue(val);
    }
    if (expr === "github.event_name") {
      return "pull_request";
    }
    resolved = false;
    return whole;
  });
  return { text, resolved };
}
