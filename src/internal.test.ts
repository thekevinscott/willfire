import { describe, expect, it } from "vitest";
import * as barrel from "./internal.js";
import type { GithubPullSummary } from "./internal.js";

describe("internal barrel", () => {
  it("exposes exactly the unpublished seams", () => {
    // One name, and it stays one name: every addition here is surface a
    // workspace tool can reach that `.` does not offer.
    expect(Object.keys(barrel).sort()).toEqual(["makeLiveExecutor"]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });

  it("re-exports the pull-summary type", () => {
    // Type-only, erased at runtime — compiling this assignment is the assertion.
    const summary: GithubPullSummary = { base: { ref: "main" }, merge_commit_sha: null };
    expect(summary.base.ref).toBe("main");
  });
});
