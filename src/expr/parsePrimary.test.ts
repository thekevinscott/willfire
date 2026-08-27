import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parsePrimary } from "./parsePrimary.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

const CALL = [
  { t: "path", v: "fromJSON" },
  { t: "op", v: "(" },
  { t: "str", v: "[5]" },
  { t: "op", v: ")" },
] as const;

describe("parsePrimary", () => {
  it("hands a bare atom through", () => {
    const cur = new Cursor([{ t: "str", v: "x" }]);
    expect(parsePrimary(cur, {})).toEqual({ kind: "value", v: "x" });
  });

  it("applies an index access to the atom", () => {
    const cur = new Cursor([...CALL, { t: "op", v: "[" }, { t: "num", v: 0 }, { t: "op", v: "]" }]);
    expect(parsePrimary(cur, {})).toEqual({ kind: "value", v: 5 });
  });

  it("refuses an unclosed bracket", () => {
    const cur = new Cursor([...CALL, { t: "op", v: "[" }, { t: "num", v: 0 }]);
    expect(parsePrimary(cur, {})).toEqual({ kind: "unknown" });
  });
});
