import { describe, expect, it } from "vitest";
import { Cursor } from "./cursor.js";
import type { Tok } from "./tokenize.js";

const TOKS: Tok[] = [
  { t: "op", v: "(" },
  { t: "num", v: 1 },
];

describe("Cursor", () => {
  it("peeks without moving", () => {
    const cur = new Cursor(TOKS);
    expect(cur.peek()).toEqual({ t: "op", v: "(" });
    expect(cur.peek()).toEqual({ t: "op", v: "(" });
  });

  it("advances one token at a time to done", () => {
    const cur = new Cursor(TOKS);
    expect(cur.done()).toBe(false);
    cur.advance();
    expect(cur.peek()).toEqual({ t: "num", v: 1 });
    cur.advance();
    expect(cur.done()).toBe(true);
    expect(cur.peek()).toBe(undefined);
  });

  it("eats only the named operator", () => {
    const cur = new Cursor(TOKS);
    expect(cur.eatOp(")")).toBe(false);
    expect(cur.eatOp("(")).toBe(true);
    expect(cur.eatOp("(")).toBe(false);
  });
});
