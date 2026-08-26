import type { Cursor } from "./cursor.js";
import { lookup } from "./lookup.js";
import { parseCall } from "./parseCall.js";
import { parseOr } from "./parseOr.js";
import { UNKNOWN, type Scope, type Val } from "./val.js";

export function parseAtom(cur: Cursor, scope: Scope): Val {
  const t = cur.peek();
  if (t == null) return UNKNOWN;
  if (t.t === "op" && t.v === "(") {
    cur.advance();
    const v = parseOr(cur, scope);
    if (!cur.eatOp(")")) return UNKNOWN;
    return v;
  }
  if (t.t === "str") {
    cur.advance();
    return { kind: "value", v: t.v };
  }
  if (t.t === "num") {
    cur.advance();
    return { kind: "value", v: t.v };
  }
  if (t.t === "bool") {
    cur.advance();
    return { kind: "value", v: t.v };
  }
  if (t.t === "null") {
    cur.advance();
    return { kind: "value", v: "" };
  }
  if (t.t === "path") {
    cur.advance();
    // A `(` right after a name makes it a call, not a path.
    if (cur.eatOp("(")) return parseCall(cur, scope, t.v);
    return lookup(scope, t.v);
  }
  return UNKNOWN;
}
