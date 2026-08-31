import { describe, expect, it } from "vitest";
import type { E2ECapture } from "../../../tests/fixtures/pinned/capture.js";
import { buildCapture } from "./buildCapture.js";

const check = (workflow: string, name: string) => ({ workflow, name, conclusion: "success" });

const PARTS: E2ECapture = {
  repo: "o/r",
  pr: 1,
  commits: { head: "head-sha", merge: "merge-sha" },
  // Deliberately not the reverse of the sorted order, so a comparator that
  // merely flipped the list could not pass for one that sorted it.
  dispatched: [check("a.yml", "two"), check("b.yml", "one"), check("a.yml", "one")],
};

describe("buildCapture", () => {
  it("sorts the dispatch on workflow then check name", () => {
    expect(buildCapture(PARTS).dispatched.map((d) => `${d.workflow} :: ${d.name}`)).toEqual([
      "a.yml :: one",
      "a.yml :: two",
      "b.yml :: one",
    ]);
  });

  it("carries the rest of the parts through untouched", () => {
    const capture = buildCapture(PARTS);
    expect(capture.repo).toBe("o/r");
    expect(capture.pr).toBe(1);
    expect(capture.commits).toEqual({ head: "head-sha", merge: "merge-sha" });
  });

  it("leaves the caller's array in the order it was handed over", () => {
    buildCapture(PARTS);
    expect(PARTS.dispatched.map((d) => d.name)).toEqual(["two", "one", "one"]);
  });
});
