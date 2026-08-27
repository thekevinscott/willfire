import { describe, expect, it, vi } from "vitest";
import { finalizePrediction } from "./finalizePrediction.js";
import type { DraftEntry, JobName, WorkflowSource } from "../types.js";

// The isolation gate wants collaborators mocked; entry settling is part of
// the aggregate this suite pins, so the mock passes the real module through.
vi.mock(
  "./finalize.js",
  async () => await vi.importActual<typeof import("./finalize.js")>("./finalize.js"),
);

const WF = ".github/workflows/w.yml";
// The brand constructor lives in entries/, which is not this unit's
// collaborator; the cast is the same claim it would make.
const j = (name: string) => name as JobName;
const src = (owner: string, repo: string, ref: string): WorkflowSource => ({
  owner,
  repo,
  ref,
  sha: `${ref}-sha`,
});

describe("finalizePrediction", () => {
  it("settles omitted checkNames to null", () => {
    const drafts: DraftEntry[] = [
      { workflow: WF, job: "*", status: "no-dispatch", reason: "no PR trigger" },
      { workflow: WF, job: j("a"), status: "unknown", reason: "dynamic matrix" },
    ];
    const { entries } = finalizePrediction(drafts, null, new Map());
    expect(entries.map((e) => e.checkName)).toEqual([null, null]);
  });

  it("aggregates checkNames deduped and sorted, from resolved run entries only", () => {
    const drafts: DraftEntry[] = [
      { workflow: WF, job: j("a"), checkName: "B", status: "run", reason: "" },
      { workflow: WF, job: j("b"), checkName: "A", status: "run", reason: "" },
      { workflow: WF, job: j("c"), checkName: "A", status: "run", reason: "" },
      { workflow: WF, job: j("d"), checkName: "C", status: "skipped", reason: "if: false" },
      { workflow: WF, job: j("e"), status: "run", reason: "" },
    ];
    expect(finalizePrediction(drafts, null, new Map()).checkNames).toEqual(["A", "B"]);
  });

  it("excludes an unknown entry's checkName from checkNames", () => {
    const drafts: DraftEntry[] = [
      { workflow: WF, job: j("a"), checkName: "A", status: "unknown", reason: "dynamic matrix" },
    ];
    expect(finalizePrediction(drafts, null, new Map()).checkNames).toEqual([]);
  });

  it("sorts sources by owner/repo@ref", () => {
    const sources = new Map<string, WorkflowSource>([
      ["z/r@v1", src("z", "r", "v1")],
      ["a/r@v1", src("a", "r", "v1")],
    ]);
    expect(finalizePrediction([], null, sources).sources.map((s) => s.owner)).toEqual([
      "a",
      "z",
    ]);
  });

  it("passes the skip verdict through", () => {
    const p = finalizePrediction([], "skip requested in HEAD commit: [skip ci]", new Map());
    expect(p.skip).toBe("skip requested in HEAD commit: [skip ci]");
    expect(p.entries).toEqual([]);
  });
});
