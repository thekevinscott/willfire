import { describe, expect, it, vi } from "vitest";
import type { GithubClient } from "willfire";
import { makeResolveRef } from "./makeResolveRef.js";

const githubOf = (getCommit: unknown): GithubClient =>
  ({ rest: { repos: { getCommit } } }) as unknown as GithubClient;

describe("makeResolveRef", () => {
  it("resolves a ref to the commit GitHub reports", async () => {
    const getCommit = vi.fn(async () => ({ data: { sha: "abc123" } }));
    const resolve = makeResolveRef(githubOf(getCommit));
    expect(await resolve({ owner: "o", repo: "r", ref: "v0" })).toBe("abc123");
    expect(getCommit).toHaveBeenCalledWith({ owner: "o", repo: "r", ref: "v0" });
  });

  it("answers null rather than throwing when the read fails", async () => {
    const resolve = makeResolveRef(
      githubOf(async () => {
        throw new Error("404");
      }),
    );
    expect(await resolve({ owner: "o", repo: "gone", ref: "v0" })).toBeNull();
  });
});
