import { describe, expect, it, vi } from "vitest";
import { Cursor } from "./cursor.js";
import { parseCall } from "./parseCall.js";

vi.mock("./cursor.js", async () => {
  const actual = await vi.importActual<typeof import("./cursor.js")>("./cursor.js");
  return { ...actual };
});

describe("parseCall", () => {
  it("accepts an empty argument list", () => {
    const cur = new Cursor([{ t: "op", v: ")" }]);
    expect(parseCall(cur, {}, "always")).toEqual({ kind: "value", v: true });
  });

  it("parses comma-separated arguments and applies the function", () => {
    const cur = new Cursor([
      { t: "str", v: "ab" },
      { t: "op", v: "," },
      { t: "str", v: "a" },
      { t: "op", v: ")" },
    ]);
    expect(parseCall(cur, {}, "contains")).toEqual({ kind: "value", v: true });
  });

  it("refuses a malformed argument list", () => {
    const cur = new Cursor([
      { t: "str", v: "a" },
      { t: "str", v: "b" },
      { t: "op", v: ")" },
    ]);
    expect(parseCall(cur, {}, "contains")).toEqual({ kind: "unknown" });
  });
});
