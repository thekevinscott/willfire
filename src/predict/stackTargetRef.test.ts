import { describe, expect, it } from "vitest";
import { stackTargetRef } from "./stackTargetRef.js";
import type { Octokit } from "@octokit/rest";
import type { StackNode } from "../types.js";

interface Fake {
  /** What a ref resolves to, keyed `owner/repo@ref`. Unlisted refs 404. */
  refs?: Record<string, string>;
  /** Parent shas by commit sha. Unlisted: no parents. */
  parents?: Record<string, string[]>;
  /** Open PRs, for the walk's `pulls.list` lookup by head branch. */
  openPrs?: { headRef: string; baseRef: string; mergeSha: string | null }[];
}

const fakeOctokit = (f: Fake) =>
  ({
    rest: {
      repos: {
        getCommit: async ({ owner, repo, ref }: Record<string, string>) => {
          const sha = (f.refs ?? {})[`${owner}/${repo}@${ref}`];
          if (sha == null) {
            throw new Error(`404 ${owner}/${repo}@${ref}`);
          }
          const parents = ((f.parents ?? {})[sha] ?? []).map((p) => ({ sha: p }));
          return { data: { sha, parents } };
        },
      },
      pulls: {
        list: async ({ head }: { head: string }) => ({
          data: (f.openPrs ?? [])
            .filter((p) => `o:${p.headRef}` === head)
            .map((p) => ({ base: { ref: p.baseRef }, merge_commit_sha: p.mergeSha })),
        }),
      },
    },
  }) as unknown as Octokit;

const walk = (pr: StackNode, f: Fake) => stackTargetRef(fakeOctokit(f), "o", "r", pr);

describe("stackTargetRef", () => {
  it("is null for a PR with no test merge", async () => {
    expect(await walk({ base: { ref: "main" }, merge_commit_sha: null }, {})).toBeNull();
  });

  it("is null when the preview sits on the base tip (normal mode)", async () => {
    const f: Fake = {
      refs: { "o/r@m0": "m0", "o/r@main": "tip-main" },
      parents: { m0: ["tip-main"] },
      openPrs: [{ headRef: "main", baseRef: "dev", mergeSha: "m0" }],
    };
    expect(await walk({ base: { ref: "main" }, merge_commit_sha: "m0" }, f)).toBeNull();
  });

  it("is null when no open PR owns the preview parent", async () => {
    // The preview parent is an old base tip, not any open PR's merge sha.
    const f: Fake = {
      refs: { "o/r@m0": "m0", "o/r@main": "tip-main" },
      parents: { m0: ["old-tip"] },
      openPrs: [
        { headRef: "main", baseRef: "dev", mergeSha: "other" },
        { headRef: "elsewhere", baseRef: "dev", mergeSha: "old-tip" },
      ],
    };
    expect(await walk({ base: { ref: "main" }, merge_commit_sha: "m0" }, f)).toBeNull();
  });

  it("is null when the preview has no parents", async () => {
    const f: Fake = { refs: { "o/r@m0": "m0" } };
    expect(await walk({ base: { ref: "main" }, merge_commit_sha: "m0" }, f)).toBeNull();
  });

  it("stops at the last proven hop when the preview cannot be read", async () => {
    // The merge sha 404s; the walk must not throw.
    expect(await walk({ base: { ref: "main" }, merge_commit_sha: "m0" }, {})).toBeNull();
  });

  it("walks one hop to the parent PR's target", async () => {
    // A child PR based on `feature-1`, whose parent PR targets `main`.
    const f: Fake = {
      refs: {
        "o/r@m-child": "m-child",
        "o/r@feature-1": "tip-1", // the base tip is NOT what the preview sits on
        "o/r@m-parent": "m-parent",
        "o/r@main": "tip-main",
      },
      parents: {
        "m-child": ["m-parent"], // built on the parent PR's test merge: stacked
        "m-parent": ["tip-main"], // parent built on the main tip: walk ends here
      },
      openPrs: [{ headRef: "feature-1", baseRef: "main", mergeSha: "m-parent" }],
    };
    expect(await walk({ base: { ref: "feature-1" }, merge_commit_sha: "m-child" }, f)).toBe(
      "main",
    );
  });

  it("stops the walk at the depth cap", async () => {
    // Ten hops in, the walk stops at the deepest proven target.
    const refs: Record<string, string> = {};
    const parents: Record<string, string[]> = {};
    const openPrs: NonNullable<Fake["openPrs"]> = [];
    for (let i = 0; i <= 12; i++) {
      refs[`o/r@m${i}`] = `m${i}`;
      refs[`o/r@b${i}`] = `t${i}`;
      parents[`m${i}`] = [`m${i + 1}`];
      openPrs.push({ headRef: `b${i}`, baseRef: `b${i + 1}`, mergeSha: `m${i + 1}` });
    }
    expect(
      await walk({ base: { ref: "b0" }, merge_commit_sha: "m0" }, { refs, parents, openPrs }),
    ).toBe("b10");
  });
});
