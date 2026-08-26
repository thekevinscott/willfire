import { applyFunction } from "./applyFunction.js";
import type { Cursor } from "./cursor.js";
import { parseOr } from "./parseOr.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

/**
 * A function call, entered after its `(` was consumed. Arguments are always
 * parsed, even for functions we cannot evaluate — the tokens have to be
 * consumed either way or the rest of the expression parses against the wrong
 * position.
 */
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
      return UNKNOWN; // malformed argument list
    }
  }
  return applyFunction(name.toLowerCase(), args);
}
