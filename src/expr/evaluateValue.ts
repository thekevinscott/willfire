import { Cursor } from "./cursor.js";
import { parseOr } from "./parseOr.js";
import { tokenize } from "./tokenize.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

export function evaluateValue(expr: string, scope: Scope = {}): Val {
  const stripped = expr.trim().replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  if (stripped === "") {
    return UNKNOWN;
  }
  if (stripped.includes("${{")) {
    return UNKNOWN;
  }
  const toks = tokenize(stripped);
  if (toks == null || toks.length === 0) {
    return UNKNOWN;
  }
  const cur = new Cursor(toks);
  const val = parseOr(cur, scope);
  if (!cur.done()) {
    return UNKNOWN;
  }
  return val;
}
