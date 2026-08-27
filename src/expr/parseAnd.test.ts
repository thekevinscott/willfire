import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseAnd } from "./parseAnd.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseAnd", () => {
  it("hands a single operand through", () => {
    const cur = new Cursor([{ t: "num", v: 1 }]);
    expect(parseAnd(cur, {})).toEqual({ kind: "value", v: 1 });
  });

  it("coalesces across &&, yielding the deciding operand", () => {
    const cur = new Cursor([
      { t: "bool", v: true },
      { t: "op", v: "&&" },
      { t: "str", v: "x" },
    ]);
    expect(parseAnd(cur, {})).toEqual({ kind: "value", v: "x" });
  });

  it("short-circuits on a falsy left", () => {
    const cur = new Cursor([
      { t: "str", v: "" },
      { t: "op", v: "&&" },
      { t: "path", v: "env.FOO" },
    ]);
    expect(parseAnd(cur, {})).toEqual({ kind: "value", v: "" });
  });
});
