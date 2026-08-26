import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { makeReader } from "./makeReader.js";
import type { WorkflowSource } from "../types.js";

const SHA = "c".repeat(40);
const SRC: WorkflowSource = { owner: "o", repo: "r", ref: "v1", sha: SHA };

/** An Octokit stand-in that counts calls and serves canned answers. */
const fakeOctokit = (opts: {
  sha?: string | null;
  content?: string | null;
}): { octokit: Octokit; calls: { commits: number; contents: number } } => {
  const calls = { commits: 0, contents: 0 };
  const octokit = {
    rest: {
      repos: {
        getCommit: async () => {
          calls.commits++;
          if (opts.sha == null) {
            throw new Error("boom");
          }
          return { data: { sha: opts.sha } };
        },
        getContent: async () => {
          calls.contents++;
          if (opts.content == null) {
            throw new Error("boom");
          }
          return { data: opts.content };
        },
      },
    },
  } as unknown as Octokit;
  return { octokit, calls };
};

describe("makeReader", () => {
  it("resolves a ref once and records the source as provenance", async () => {
    const { octokit, calls } = fakeOctokit({ sha: SHA });
    const sources = new Map<string, WorkflowSource>();
    const reader = makeReader(octokit, sources);
    expect(await reader.resolveRef(SRC)).toBe(SHA);
    expect(await reader.resolveRef(SRC)).toBe(SHA);
    expect(calls.commits).toBe(1);
    expect([...sources.values()]).toEqual([{ ...SRC, sha: SHA }]);
  });

  it("caches a resolution miss and records nothing", async () => {
    const { octokit, calls } = fakeOctokit({ sha: null });
    const sources = new Map<string, WorkflowSource>();
    const reader = makeReader(octokit, sources);
    expect(await reader.resolveRef(SRC)).toBeNull();
    expect(await reader.resolveRef(SRC)).toBeNull();
    expect(calls.commits).toBe(1);
    expect(sources.size).toBe(0);
  });

  it("fetches a workflow once per commit-keyed path", async () => {
    const { octokit, calls } = fakeOctokit({ content: "on: push" });
    const reader = makeReader(octokit, new Map());
    expect(await reader.fetchWorkflow("w.yml", SRC)).toBe("on: push");
    // The same commit named through a different ref is the same read.
    expect(await reader.fetchWorkflow("w.yml", { ...SRC, ref: "v1.0.0" })).toBe("on: push");
    expect(calls.contents).toBe(1);
  });

  it("caches a fetch miss", async () => {
    const { octokit, calls } = fakeOctokit({ content: null });
    const reader = makeReader(octokit, new Map());
    expect(await reader.fetchWorkflow("w.yml", SRC)).toBeNull();
    expect(await reader.fetchWorkflow("w.yml", SRC)).toBeNull();
    expect(calls.contents).toBe(1);
  });
});
