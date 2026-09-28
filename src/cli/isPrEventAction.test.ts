import { describe, expect, it } from "vitest";
import { isPrEventAction } from "./isPrEventAction.js";

// Spelled out rather than imported from types.ts: the pin is that each
// documented activity type is accepted, which an import would make circular.
const DOCUMENTED = [
  "assigned",
  "auto_merge_disabled",
  "auto_merge_enabled",
  "closed",
  "converted_to_draft",
  "demilestoned",
  "dequeued",
  "edited",
  "enqueued",
  "labeled",
  "locked",
  "milestoned",
  "opened",
  "ready_for_review",
  "reopened",
  "review_request_removed",
  "review_requested",
  "synchronize",
  "unassigned",
  "unlabeled",
  "unlocked",
];

describe("isPrEventAction", () => {
  it("accepts every documented pull_request activity type", () => {
    expect(DOCUMENTED).toHaveLength(21);
    for (const action of DOCUMENTED) {
      expect(isPrEventAction(action)).toBe(true);
    }
  });

  it("refuses anything else", () => {
    expect(isPrEventAction("syncronize")).toBe(false);
    expect(isPrEventAction("published")).toBe(false);
    expect(isPrEventAction("")).toBe(false);
  });
});
