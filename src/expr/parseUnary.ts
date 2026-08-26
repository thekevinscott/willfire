import { asBool } from "./asBool.js";
import type { Cursor } from "./cursor.js";
import { negate } from "./negate.js";
import { parsePrimary } from "./parsePrimary.js";
import { truthy } from "./truthy.js";
import type { Scope, Val } from "./val.js";

export function parseUnary(cur: Cursor, scope: Scope): Val {
  if (cur.eatOp("!")) {
    const v = parseUnary(cur, scope);
    return asBool(negate(truthy(v)));
  }
  return parsePrimary(cur, scope);
}
