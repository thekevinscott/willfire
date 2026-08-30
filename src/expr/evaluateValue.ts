import { Cursor } from "./cursor.js";
import { parseOr } from "./parseOr.js";
import { tokenize } from "./tokenize.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

/**
 * Evaluate an expression to a value, or UNKNOWN when it cannot be settled.
 *
 * The `${{ }}` wrapper is optional in `if:` and stripped when present. An
 * expression that is only *partly* wrapped (`foo ${{ bar }} baz`) is a string
 * interpolation rather than an expression, and is not modelled.
 *
 * A `if:` wants {@link evaluate}, which is this narrowed to truthiness. This
 * one is for the places that need the value itself — a matrix axis written as
 * `${{ fromJSON(...) }}` is an array, and its truthiness says nothing about
 * how many jobs it schedules.
 */
export function evaluateValue(expr: string, scope: Scope = {}): Val {
  const stripped = expr.trim().replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  if (stripped === "") {
    return UNKNOWN;
  }
  if (stripped.includes("${{")) {
    return UNKNOWN;
  }
  const toks = tokenize(stripped);
  if (toks === null) {
    return UNKNOWN;
  }
  const cur = new Cursor(toks);
  const val = parseOr(cur, scope);
  // Trailing tokens mean the grammar did not cover this expression; whatever
  // was parsed describes only a prefix of it, so it decides nothing.
  if (!cur.done()) {
    return UNKNOWN;
  }
  return val;
}
