import type { Tok } from "./tokenize.js";

/** A read position over a token stream, shared by the parse functions. */
export class Cursor {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  advance(): void {
    this.pos++;
  }

  eatOp(v: string): boolean {
    const t = this.peek();
    if (t != null && t.t === "op" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  done(): boolean {
    return this.pos >= this.toks.length;
  }
}
