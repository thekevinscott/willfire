import { describe, expect, it } from "vitest";
import type { Ctx, DetailedCombo, DraftEntry, WorkflowSource } from "./types.js";

describe("prediction types", () => {
  it("shape a context, a source, a combo, and a draft entry", () => {
    const ctx: Ctx = { action: "opened", baseRef: "main", files: ["a.ts"] };
    const source: WorkflowSource = { owner: "o", repo: "r", ref: "main", sha: "a".repeat(40) };
    const combo: DetailedCombo = { values: { os: "linux" }, displayKeys: ["os"] };
    const entry: DraftEntry = {
      workflow: ".github/workflows/test.yml",
      job: "*",
      status: "no-dispatch",
      reason: "no pull_request trigger",
    };
    expect([ctx.action, source.sha.length, combo.displayKeys, entry.status]).toEqual([
      "opened",
      40,
      ["os"],
      "no-dispatch",
    ]);
  });
});
