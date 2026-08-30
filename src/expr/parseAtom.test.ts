import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseAtom } from "./parseAtom.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseAtom", () => {
  it("is unknown at the end of the tokens", () => {
    expect(parseAtom(new Cursor([]), {})).toEqual({ kind: "unknown" });
    // A consumed cursor, not just an empty one: peek is undefined either way.
    const spent = new Cursor([{ t: "null" }]);
    parseAtom(spent, {});
    expect(parseAtom(spent, {})).toEqual({ kind: "unknown" });
  });

  it("reads each literal kind, coercing null to the empty string", () => {
    expect(parseAtom(new Cursor([{ t: "str", v: "s" }]), {})).toEqual({ kind: "value", v: "s" });
    expect(parseAtom(new Cursor([{ t: "num", v: 2 }]), {})).toEqual({ kind: "value", v: 2 });
    expect(parseAtom(new Cursor([{ t: "bool", v: true }]), {})).toEqual({ kind: "value", v: true });
    expect(parseAtom(new Cursor([{ t: "null" }]), {})).toEqual({ kind: "value", v: "" });
  });

  it("groups a parenthesized expression and refuses an unclosed one", () => {
    const closed = new Cursor([
      { t: "op", v: "(" },
      { t: "bool", v: true },
      { t: "op", v: ")" },
    ]);
    expect(parseAtom(closed, {})).toEqual({ kind: "value", v: true });
    const open = new Cursor([
      { t: "op", v: "(" },
      { t: "bool", v: true },
    ]);
    expect(parseAtom(open, {})).toEqual({ kind: "unknown" });
  });

  it("resolves a path against the scope", () => {
    const cur = new Cursor([{ t: "path", v: "inputs.mode" }]);
    const scope = { inputs: { mode: { kind: "value", v: "fast" } as const } };
    expect(parseAtom(cur, scope)).toEqual({ kind: "value", v: "fast" });
  });

  it("treats a path followed by ( as a call", () => {
    const cur = new Cursor([
      { t: "path", v: "always" },
      { t: "op", v: "(" },
      { t: "op", v: ")" },
    ]);
    expect(parseAtom(cur, {})).toEqual({ kind: "value", v: true });
  });

  it("is unknown on a stray operator", () => {
    expect(parseAtom(new Cursor([{ t: "op", v: "," }]), {})).toEqual({ kind: "unknown" });
  });
});
