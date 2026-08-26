import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize.js";

describe("tokenize", () => {
  it("skips whitespace of every kind", () => {
    expect(tokenize(" \t\n\r")).toEqual([]);
  });

  it("reads a doubled quote inside a string as one literal quote", () => {
    expect(tokenize("'it''s'")).toEqual([{ t: "str", v: "it's" }]);
  });

  it("refuses an unterminated string", () => {
    expect(tokenize("'open")).toBe(null);
  });

  it("matches the longest operator first", () => {
    expect(tokenize("a<=b")).toEqual([
      { t: "path", v: "a" },
      { t: "op", v: "<=" },
      { t: "path", v: "b" },
    ]);
  });

  it("reads keywords case-insensitively and keeps a path's case", () => {
    expect(tokenize("True FALSE Null foo.Bar-baz")).toEqual([
      { t: "bool", v: true },
      { t: "bool", v: false },
      { t: "null" },
      { t: "path", v: "foo.Bar-baz" },
    ]);
  });

  it("reads negative and decimal numbers", () => {
    expect(tokenize("-1.5 42")).toEqual([
      { t: "num", v: -1.5 },
      { t: "num", v: 42 },
    ]);
  });

  it("refuses a character it has no token for", () => {
    expect(tokenize("true @")).toBe(null);
  });
});
