import type { Cursor } from "./cursor.js";
import { indexVal } from "./indexVal.js";
import { parseAtom } from "./parseAtom.js";
import { parseOr } from "./parseOr.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

/** An atom plus any `[...]` accesses hanging off it, tightest-binding. */
export function parsePrimary(cur: Cursor, scope: Scope): Val {
  let v = parseAtom(cur, scope);
  while (cur.eatOp("[")) {
    const idx = parseOr(cur, scope);
    if (!cur.eatOp("]")) {
      return UNKNOWN;
    }
    v = indexVal(v, idx);
  }
  return v;
}
