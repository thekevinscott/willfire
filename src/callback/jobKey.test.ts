import { describe, expect, it } from "vitest";
import { jobKey } from "./jobKey.js";
import type { JobSite } from "../types.js";

const SHA = "a".repeat(40);

const site = (owner: string, repo: string, path: string): JobSite => ({
  path,
  source: { owner, repo, ref: "v0", sha: SHA },
});

describe("jobKey", () => {
  it("qualifies every key by repo, workflow path, then job id after the last colon", () => {
    expect(jobKey(site("thekevinscott", "willfire", ".github/workflows/test.yml"), "detect")).toBe(
      "thekevinscott/willfire/.github/workflows/test.yml:detect",
    );
  });

  it("names the definition site, so a callee keys under its own repo", () => {
    expect(jobKey(site("o2", "callee", ".github/workflows/_matrix.yml"), "plan")).toBe(
      "o2/callee/.github/workflows/_matrix.yml:plan",
    );
  });

  it("carries neither the ref nor the sha", () => {
    const a = jobKey(site("o", "r", ".github/workflows/w.yml"), "j");
    const b = jobKey(
      { path: ".github/workflows/w.yml", source: { owner: "o", repo: "r", ref: "main", sha: "b".repeat(40) } },
      "j",
    );
    expect(a).toBe(b);
  });
});
