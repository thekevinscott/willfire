import { evaluateValue } from "../expr/evaluateValue.js";
import { formatMatrixValue } from "../matrix/formatMatrixValue.js";
import type { Combo, Rendered } from "../types.js";

/**
 * Each `${{ }}` slot goes through the expression evaluator, not a prefix test.
 * `matrix.build && format(' {0}', matrix.build) || ''` starts with `matrix.`
 * but is not a path, and treating it as one left the whole name unresolved.
 *
 * `github.event_name` is fixed because prediction only answers for a pull
 * request.
 */
export function renderName(template: string, combo: Combo): Rendered {
  let resolved = true;
  const scope = { github: { event_name: "pull_request" }, matrix: combo ?? undefined };
  const text = template.replace(/\$\{\{(.*?)\}\}/g, (whole, inner) => {
    const val = evaluateValue(String(inner), scope);
    if (val.kind !== "value" && val.kind !== "json") {
      resolved = false;
      return whole;
    }
    return formatMatrixValue(val.v);
  });
  return { text, resolved };
}
