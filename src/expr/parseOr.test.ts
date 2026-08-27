import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseOr } from "./parseOr.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseOr", () => {
  it("hands a single operand through", () => {
    const cur = new Cursor([{ t: "bool", v: true }]);
    expect(parseOr(cur, {})).toEqual({ kind: "value", v: true });
  });

  it("coalesces across ||, yielding the first truthy operand", () => {
    const cur = new Cursor([
      { t: "str", v: "" },
      { t: "op", v: "||" },
      { t: "str", v: "" },
      { t: "op", v: "||" },
      { t: "str", v: "c" },
    ]);
    expect(parseOr(cur, {})).toEqual({ kind: "value", v: "c" });
  });
});
