import { coalesceOr } from "./coalesceOr.js";
import type { Cursor } from "./cursor.js";
import { parseAnd } from "./parseAnd.js";
import type { Scope, Val } from "./val.js";

export function parseOr(cur: Cursor, scope: Scope): Val {
  let left = parseAnd(cur, scope);
  while (cur.eatOp("||")) {
    const right = parseAnd(cur, scope);
    left = coalesceOr(left, right);
  }
  return left;
}
