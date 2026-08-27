import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { makeResolveRef } from "./makeResolveRef.js";
import type { WorkflowSource } from "../types.js";

const SHA = "a".repeat(40);

function fake(sha: string | null, calls: string[]): Octokit {
  return {
    rest: {
      repos: {
        getCommit: async (a: { owner: string; repo: string; ref: string }) => {
          calls.push(`${a.owner}/${a.repo}@${a.ref}`);
          if (sha == null) {
            throw new Error("nope");
          }
          return { data: { sha } };
        },
      },
    },
  } as unknown as Octokit;
}

describe("makeResolveRef", () => {
  it("resolves a ref, pins it into sources, and caches the answer", async () => {
    const calls: string[] = [];
    const sources = new Map<string, WorkflowSource>();
    const resolve = makeResolveRef(fake(SHA, calls), sources);
    expect(await resolve({ owner: "o", repo: "r", ref: "v1" })).toBe(SHA);
    expect(await resolve({ owner: "o", repo: "r", ref: "v1" })).toBe(SHA);
    expect(calls).toEqual(["o/r@v1"]);
    expect(sources.get("o/r@v1")).toEqual({ owner: "o", repo: "r", ref: "v1", sha: SHA });
  });

  it("caches a failed resolution without pinning a source", async () => {
    const calls: string[] = [];
    const sources = new Map<string, WorkflowSource>();
    const resolve = makeResolveRef(fake(null, calls), sources);
    expect(await resolve({ owner: "o", repo: "r", ref: "gone" })).toBe(null);
    expect(await resolve({ owner: "o", repo: "r", ref: "gone" })).toBe(null);
    expect(calls).toEqual(["o/r@gone"]);
    expect(sources.size).toBe(0);
  });
});
