import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { E2ECapture } from "../../../tests/fixtures/pinned/capture.js";
import { buildCapture } from "./buildCapture.js";

const check = (workflow: string, name: string) => ({ workflow, name, conclusion: "success" });

const PARTS: Omit<E2ECapture, "capturedAt"> = {
  repo: "o/r",
  pr: 1,
  shape: "one workflow",
  commits: { head: "head-sha", merge: "merge-sha" },
  // Deliberately not the reverse of the sorted order, so a comparator that
  // merely flipped the list could not pass for one that sorted it.
  dispatched: [check("a.yml", "two"), check("b.yml", "one"), check("a.yml", "one")],
  predicted: { checkNames: ["one"], entries: [], sources: [], skip: null },
  recording: {
    api: [{ key: "b" }, { key: "c" }, { key: "a" }],
    exec: [
      { key: "y", job: "j", outcome: { ok: true, outputs: {} } },
      { key: "z", job: "j", outcome: { ok: true, outputs: {} } },
      { key: "x", job: "j", outcome: { ok: true, outputs: {} } },
    ],
  },
};

describe("buildCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps the capture time", () => {
    expect(buildCapture(PARTS).capturedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("sorts the dispatch on workflow then check name", () => {
    expect(buildCapture(PARTS).dispatched.map((d) => `${d.workflow} :: ${d.name}`)).toEqual([
      "a.yml :: one",
      "a.yml :: two",
      "b.yml :: one",
    ]);
  });

  it("sorts both recordings on their key", () => {
    const { recording } = buildCapture(PARTS);
    expect(recording.api.map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(recording.exec.map((r) => r.key)).toEqual(["x", "y", "z"]);
  });

  it("carries the rest of the parts through untouched", () => {
    const capture = buildCapture(PARTS);
    expect(capture.repo).toBe("o/r");
    expect(capture.pr).toBe(1);
    expect(capture.shape).toBe("one workflow");
    expect(capture.commits).toEqual({ head: "head-sha", merge: "merge-sha" });
    expect(capture.predicted).toEqual({
      checkNames: ["one"],
      entries: [],
      sources: [],
      skip: null,
    });
  });

  it("leaves the caller's arrays in the order they were handed over", () => {
    buildCapture(PARTS);
    expect(PARTS.dispatched.map((d) => d.name)).toEqual(["two", "one", "one"]);
    expect(PARTS.recording.api.map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(PARTS.recording.exec.map((r) => r.key)).toEqual(["y", "z", "x"]);
  });
});
