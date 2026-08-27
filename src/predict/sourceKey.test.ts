import { describe, expect, it } from "vitest";
import { sourceKey } from "./sourceKey.js";

describe("sourceKey", () => {
  it("keys a source by owner, repo and the ref as written", () => {
    expect(sourceKey({ owner: "o", repo: "r", ref: "v1" })).toBe("o/r@v1");
    const pinned = { owner: "o", repo: "r", ref: "v1", sha: "a".repeat(40) };
    expect(sourceKey(pinned)).toBe("o/r@v1");
  });
});
