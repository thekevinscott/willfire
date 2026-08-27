import { describe, expect, it } from "vitest";
import { expandUses } from "./expandUses.js";
import type { Scope } from "../expr/val.js";
import type {
  Ctx,
  DetailedCombos,
  FetchWorkflow,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

const SHA = "a".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const CTX: Ctx = { action: "opened", baseRef: "main", files: [] };
const LOCAL = "./.github/workflows/sub.yml";

const readerFor = (fetchWorkflow: FetchWorkflow): WorkflowReader => ({
  fetchWorkflow,
  resolveRef: async (src) => src.ref,
});

const expand = (
  job: Workflow,
  combos: DetailedCombos,
  reader: WorkflowReader,
  note = "",
  scoped: Scope = {},
) => expandUses("call", job, combos, note, CTX, reader, SOURCE, 0, "", true, scoped);

describe("expandUses", () => {
  it("reports a dynamic caller matrix as one unknown entry, with the note", async () => {
    const entries = await expand(
      { uses: LOCAL } as Workflow,
      null,
      readerFor(async () => null),
      "; executing 'a' failed: boom",
    );
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix on reusable workflow call; executing 'a' failed: boom",
      },
    ]);
  });

  it("inlines the callee's jobs under the calling job's name", async () => {
    const reader = readerFor(async () =>
      JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } }),
    );
    const entries = await expand({ uses: LOCAL } as Workflow, [null], reader);
    expect(entries).toEqual([
      { job: "call / inner", checkName: "call / inner", status: "run", reason: "" },
    ]);
  });

  it("multiplies the callee set by the caller's matrix", async () => {
    const reader = readerFor(async () =>
      JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } }),
    );
    const combos: DetailedCombos = [
      { values: { os: "linux" }, displayKeys: ["os"] },
      { values: { os: "mac" }, displayKeys: ["os"] },
    ];
    const entries = await expand({ uses: LOCAL } as Workflow, combos, reader);
    expect(entries.map((e) => e.job)).toEqual(["call (linux) / inner", "call (mac) / inner"]);
  });

  it("reports a resolution failure once per combination", async () => {
    const entries = await expand({ uses: LOCAL } as Workflow, [null], readerFor(async () => null));
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: `cannot fetch ${LOCAL}`,
      },
    ]);
  });

  it("reports a callee that parses to nothing as unresolvable", async () => {
    const entries = await expand({ uses: LOCAL } as Workflow, [null], readerFor(async () => ""));
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: `cannot resolve ${LOCAL}`,
      },
    ]);
  });
});
