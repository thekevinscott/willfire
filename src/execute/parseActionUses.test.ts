import { describe, expect, it } from "vitest";
import { parseActionUses } from "./parseActionUses.js";

describe("parseActionUses", () => {
  it("parses owner/repo@ref with the path empty", () => {
    expect(parseActionUses("o/act@v1")).toEqual({
      path: "",
      source: { owner: "o", repo: "act", ref: "v1" },
    });
  });

  it("parses a subdirectory path", () => {
    expect(parseActionUses("o/act/dir/sub@abc")).toEqual({
      path: "dir/sub",
      source: { owner: "o", repo: "act", ref: "abc" },
    });
  });

  it("returns null for expressions and docker images", () => {
    expect(parseActionUses("o/act@${{ github.sha }}")).toBe(null);
    expect(parseActionUses("docker://alpine:3")).toBe(null);
  });

  it("returns null for anything without owner, repo, and ref", () => {
    expect(parseActionUses("actions/setup-node")).toBe(null);
    expect(parseActionUses("@v1")).toBe(null);
    expect(parseActionUses("single@v1")).toBe(null);
    expect(parseActionUses("o/a@")).toBe(null);
  });
});
