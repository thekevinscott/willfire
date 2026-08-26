import { describe, expect, it } from "vitest";
import { parseActionUses } from "./parseActionUses.js";

describe("parseActionUses", () => {
  it("parses owner/repo@ref with an empty path", () => {
    expect(parseActionUses("o/r@v1")).toEqual({
      path: "",
      source: { owner: "o", repo: "r", ref: "v1" },
    });
  });

  it("parses a subdirectory path", () => {
    expect(parseActionUses("o/r/a/b@abc")).toEqual({
      path: "a/b",
      source: { owner: "o", repo: "r", ref: "abc" },
    });
  });

  it("rejects what is not owner/repo@ref", () => {
    for (const uses of [
      "actions/setup-node", // no ref
      "docker://alpine:3",
      "${{ matrix.action }}@v1",
      "@v1", // no owner
      "single@v1", // no repo
      "o/r@", // empty ref
    ]) {
      expect(parseActionUses(uses)).toBe(null);
    }
  });
});
