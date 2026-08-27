import { applyFunction } from "./applyFunction.js";
import type { Cursor } from "./cursor.js";
import { parseOr } from "./parseOr.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

export function parseCall(cur: Cursor, scope: Scope, name: string): Val {
  const args: Val[] = [];
  if (!cur.eatOp(")")) {
    for (;;) {
      args.push(parseOr(cur, scope));
      if (cur.eatOp(",")) {
        continue;
      }
      if (cur.eatOp(")")) {
        break;
      }
      return UNKNOWN;
    }
  }
  return applyFunction(name.toLowerCase(), args);
}
