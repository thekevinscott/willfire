import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { makeFetchWorkflow } from "./makeFetchWorkflow.js";
import type { WorkflowSource } from "../types.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const srcAt = (sha: string): WorkflowSource => ({ owner: "o", repo: "r", ref: "main", sha });

function fake(content: string | null, calls: string[]): Octokit {
  return {
    rest: {
      repos: {
        getContent: async (a: { owner: string; repo: string; path: string; ref: string }) => {
          calls.push(`${a.owner}/${a.repo}/${a.path}@${a.ref}`);
          if (content == null) {
            throw new Error("404");
          }
          return { data: content };
        },
      },
    },
  } as unknown as Octokit;
}

describe("makeFetchWorkflow", () => {
  it("reads at the pinned sha and caches per commit, not per ref", async () => {
    const calls: string[] = [];
    const fetch = makeFetchWorkflow(fake("on: push\n", calls));
    expect(await fetch("wf.yml", srcAt(SHA_A))).toBe("on: push\n");
    expect(await fetch("wf.yml", srcAt(SHA_A))).toBe("on: push\n");
    expect(await fetch("wf.yml", srcAt(SHA_B))).toBe("on: push\n");
    expect(calls).toEqual([`o/r/wf.yml@${SHA_A}`, `o/r/wf.yml@${SHA_B}`]);
  });

  it("caches a failed read as null", async () => {
    const calls: string[] = [];
    const fetch = makeFetchWorkflow(fake(null, calls));
    expect(await fetch("wf.yml", srcAt(SHA_A))).toBe(null);
    expect(await fetch("wf.yml", srcAt(SHA_A))).toBe(null);
    expect(calls).toEqual([`o/r/wf.yml@${SHA_A}`]);
  });
});
