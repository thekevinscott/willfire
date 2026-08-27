import { describe, expect, it } from "vitest";
import { parseUses } from "./parseUses.js";

describe("parseUses", () => {
  it("parses both spellings and takes the ref from the last @", () => {
    expect(parseUses("./.github/workflows/x.yml")).toEqual({
      path: ".github/workflows/x.yml",
      source: null,
    });
    expect(parseUses("o/r/.github/workflows/x.yml@v1")).toEqual({
      path: ".github/workflows/x.yml",
      source: { owner: "o", repo: "r", ref: "v1" },
    });
    // A branch name may contain a slash, so the ref is everything after the
    // last `@` rather than the next path segment.
    expect(parseUses("o/r/w.yml@feature/foo")).toEqual({
      path: "w.yml",
      source: { owner: "o", repo: "r", ref: "feature/foo" },
    });
  });

  it("keeps an earlier @ inside the path and splits at the last one", () => {
    expect(parseUses("o/r/x@y.yml@v1")).toEqual({
      path: "x@y.yml",
      source: { owner: "o", repo: "r", ref: "v1" },
    });
  });

  it.each([
    ["${{ env.CALLEE }}/.github/workflows/x.yml@v1", "built from an expression"],
    ["./", "a local path with nothing after it"],
    ["not-a-reference", "no @ at all"],
    ["owner/repo@v1", "no path between the repo and the ref"],
    ["owner/repo/x.yml@", "an empty ref"],
    ["@v1", "an empty address"],
  ])("rejects %j — %s", (uses) => {
    expect(parseUses(uses)).toBeNull();
  });
});
