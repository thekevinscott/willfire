import { compare } from "./compare.js";
import type { Cursor } from "./cursor.js";
import { parseUnary } from "./parseUnary.js";
import type { Scope, Val } from "./val.js";

export function parseCmp(cur: Cursor, scope: Scope): Val {
  const left = parseUnary(cur, scope);
  for (const op of ["==", "!=", "<=", ">=", "<", ">"]) {
    if (cur.eatOp(op)) {
      const right = parseUnary(cur, scope);
      return compare(op, left, right);
    }
  }
  return left;
}
