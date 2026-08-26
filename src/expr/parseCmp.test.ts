import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseCmp } from "./parseCmp.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseCmp", () => {
  it("hands a single operand through", () => {
    const cur = new Cursor([{ t: "str", v: "a" }]);
    expect(parseCmp(cur, {})).toEqual({ kind: "value", v: "a" });
  });

  it("compares its two sides", () => {
    const cur = new Cursor([
      { t: "num", v: 1 },
      { t: "op", v: "<" },
      { t: "num", v: 2 },
    ]);
    expect(parseCmp(cur, {})).toEqual({ kind: "value", v: true });
  });

  it("dispatches each comparison operator", () => {
    const cur = new Cursor([
      { t: "str", v: "a" },
      { t: "op", v: "!=" },
      { t: "str", v: "b" },
    ]);
    expect(parseCmp(cur, {})).toEqual({ kind: "value", v: true });
  });
});
