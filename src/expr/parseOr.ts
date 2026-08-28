import { coalesceOr } from "./coalesceOr.js";
import type { Cursor } from "./cursor.js";
import { parseAnd } from "./parseAnd.js";
import type { Scope, Val } from "./val.js";

/**
 * `&&` and `||` are value operators, not boolean ones — `a || b` yields the
 * first truthy operand, which is why `(x || y) != '[]'` parses as a comparison
 * against a coalesced value rather than a boolean.
 */
export function parseOr(cur: Cursor, scope: Scope): Val {
  let left = parseAnd(cur, scope);
  while (cur.eatOp("||")) {
    const right = parseAnd(cur, scope);
    left = coalesceOr(left, right);
  }
  return left;
}
