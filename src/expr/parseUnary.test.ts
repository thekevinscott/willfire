import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseUnary } from "./parseUnary.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseUnary", () => {
  it("hands an unnegated primary through", () => {
    const cur = new Cursor([{ t: "num", v: 0 }]);
    expect(parseUnary(cur, {})).toEqual({ kind: "value", v: 0 });
  });

  it("negates to a concrete boolean value", () => {
    const cur = new Cursor([
      { t: "op", v: "!" },
      { t: "bool", v: false },
    ]);
    expect(parseUnary(cur, {})).toEqual({ kind: "value", v: true });
  });

  it("nests", () => {
    const cur = new Cursor([
      { t: "op", v: "!" },
      { t: "op", v: "!" },
      { t: "bool", v: true },
    ]);
    expect(parseUnary(cur, {})).toEqual({ kind: "value", v: true });
  });
});
