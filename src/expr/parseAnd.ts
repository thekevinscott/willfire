import { coalesceAnd } from "./coalesceAnd.js";
import type { Cursor } from "./cursor.js";
import { parseCmp } from "./parseCmp.js";
import type { Scope, Val } from "./val.js";

export function parseAnd(cur: Cursor, scope: Scope): Val {
  let left = parseCmp(cur, scope);
  while (cur.eatOp("&&")) {
    const right = parseCmp(cur, scope);
    left = coalesceAnd(left, right);
  }
  return left;
}
