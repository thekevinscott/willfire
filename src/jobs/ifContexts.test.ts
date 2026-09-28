import { describe, expect, it } from "vitest";
import { ifContexts } from "./ifContexts.js";

describe("ifContexts", () => {
  it("names the head segment of every path read", () => {
    expect(ifContexts("github.event_name == 'x' && secrets.A != vars.B")).toEqual([
      "github",
      "secrets",
      "vars",
    ]);
  });

  it("does not see a name inside a string literal", () => {
    expect(ifContexts("contains(github.x, 'secrets.Y')")).toEqual(["contains", "github"]);
  });

  it("lowercases, since GitHub context names are case-insensitive", () => {
    expect(ifContexts("SECRETS.A")).toEqual(["secrets"]);
  });

  it("answers nothing for an expression it cannot tokenize", () => {
    expect(ifContexts("secrets.A == 'unterminated")).toEqual([]);
  });
});
