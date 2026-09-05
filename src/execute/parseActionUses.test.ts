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
    expect(parseActionUses("o/r/sub/dir@" + "a".repeat(40))).toEqual({
      path: "sub/dir",
      source: { owner: "o", repo: "r", ref: "a".repeat(40) },
    });
  });

  it("refuses templates, docker, and shapes with no owner, repo, or ref", () => {
    for (const uses of [
      "${{ matrix.action }}@v1",
      "o/r@${{ github.sha }}",
      "docker://alpine:3",
      "@v1",
      "no-at-sign",
      "o/r/path",
      "single@v1",
      "o/r@",
    ]) {
      expect(parseActionUses(uses)).toBe(null);
    }
  });

  it("reads the docker guard as a scheme prefix, not a substring", () => {
    expect(parseActionUses("o/r@docker://")).toEqual({
      path: "",
      source: { owner: "o", repo: "r", ref: "docker://" },
    });
  });
});
