import { describe, expect, it } from "vitest";
import { expandWorkflowJobs } from "./expandWorkflowJobs.js";
import type { ExecOutcome, JobExecutor } from "../execute/types.js";
import type { FetchWorkflow, ResolveRef, WorkflowReader, WorkflowSource } from "../types.js";

/** A 40-hex commit id, so anything pinned to it is already resolved. */
const SHA = "a".repeat(40);

const readerOf = (
  fetchWorkflow: FetchWorkflow,
  resolveRef: ResolveRef = async (src) => src.ref,
): WorkflowReader => ({ fetchWorkflow, resolveRef });

// `expandWorkflowJobs` is the seam the recorded-behaviour suite drives
// (tests/integration/names.test.ts). That suite pins check names against live
// dispatches; this covers the wrapper itself — that it forwards to the job
// expansion and hands back the entries unchanged.
describe("expandWorkflowJobs", () => {
  // Where expansion starts from. Nothing here calls out to another workflow, so
  // the source is only carried, never followed.
  const SOURCE = { owner: "o", repo: "r", ref: "main", sha: SHA };

  it("expands a parsed workflow into its job entries", async () => {
    const wf = { on: { pull_request: null }, jobs: { build: { "runs-on": "ubuntu-latest" } } };
    const entries = await expandWorkflowJobs(
      wf as never,
      { action: "opened", baseRef: "main", files: ["src/app.txt"] },
      readerOf(async () => null),
      SOURCE,
    );
    expect(entries).toEqual([
      { job: "build", checkName: "build", status: "run", reason: "" },
    ]);
  });
});

// The check-name readout for an empty matrix: it has to produce no entries,
// not one. `[null]` inside the expander means "a job with no matrix", whose
// check is the bare job name — and that is a name GitHub never creates for a
// job that declares a matrix, so predicting it invents a check.
describe("a job whose matrix expands to nothing", () => {
  const SOURCE = { owner: "o", repo: "r", ref: SHA, sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.txt"] };
  const NO_FETCH = async () => null;

  it("produces no entries at all", async () => {
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            strategy: { matrix: { language: [] } },
          },
        },
      } as never,
      CTX,
      readerOf(NO_FETCH),
      SOURCE,
    );
    expect(entries).toEqual([]);
  });

  it("does not dispatch the workflow a caller with an empty matrix calls", async () => {
    const fetched: string[] = [];
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: {
          call: {
            uses: "./.github/workflows/callee.yml",
            strategy: { matrix: { language: [] } },
          },
        },
      } as never,
      CTX,
      readerOf(async (path: string) => {
        fetched.push(path);
        return JSON.stringify({ jobs: { inner: { "runs-on": "ubuntu-latest" } } });
      }),
      SOURCE,
    );
    expect(entries).toEqual([]);
    // The callee is still read once — resolution happens before the matrix is
    // walked — but nothing it declares becomes a check.
    expect(fetched).toEqual([".github/workflows/callee.yml"]);
  });
});

// `needs` is workflow-scoped and `with:` descends through a call; neither
// spreads anywhere else. These pin the two isolation directions.
describe("scope isolation across the call boundary", () => {
  const SOURCE = { owner: "o", repo: "r", ref: SHA, sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.txt"] };

  /**
   * A called workflow, as the text `fetchWorkflow` hands back. JSON is valid
   * YAML, so serializing the document is enough — and it keeps this suite from
   * importing `yaml`, which a unit test has no business reaching for.
   */
  const calleeDoc = (doc: Record<string, unknown>) => JSON.stringify(doc);

  it("does not carry the outputs into a called workflow", async () => {
    // `needs` is workflow-scoped: a callee's `needs.detect` is the callee's own
    // job, not the caller's. Inheriting the map would answer for the wrong one.
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: { call: { uses: "./.github/workflows/callee.yml" } },
      } as never,
      CTX,
      readerOf(async () =>
        JSON.stringify({
          jobs: {
            inner: { "runs-on": "ubuntu-latest", if: "needs.detect.outputs.langs != '[]'" },
          },
        }),
      ),
      SOURCE,
      { needs: { detect: { outputs: { langs: '["typescript"]' } } } },
    );
    // The name is still resolvable — it is the guard that is not.
    expect(entries).toEqual([
      {
        job: "call / inner",
        checkName: "call / inner",
        status: "unknown",
        reason: "if: \"needs.detect.outputs.langs != '[]'\"",
      },
    ]);
  });

  it("does not leak the caller's inputs into a sibling job", async () => {
    // Scope descends through a call; it does not spread sideways.
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: {
          c: { uses: "./.github/workflows/callee.yml", with: { x: "v" } },
          sibling: { "runs-on": "ubuntu-latest", if: "inputs.x == 'v'" },
        },
      } as never,
      CTX,
      readerOf(async () =>
        calleeDoc({
          on: { workflow_call: { inputs: { x: { type: "string" } } } },
          jobs: { inner: { "runs-on": "ubuntu-latest" } },
        }),
      ),
      SOURCE,
    );
    expect(entries.find((e) => e.job === "sibling")?.status).toBe("unknown");
  });
});

// The executor here is faked; what it actually does when it runs things is
// execute.test.ts's subject.
describe("derived execution during expansion", () => {
  const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: "main", sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.ts"] };
  const reader = readerOf(async () => null);

  /** A detect-shaped workflow: one producer, one dynamic-matrix consumer. */
  const wfWith = (detect: Record<string, unknown> | null) => ({
    on: { pull_request: null },
    jobs: {
      detect,
      cover: {
        needs: "detect",
        name: "Coverage (${{ matrix.language }})",
        strategy: { matrix: { language: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
      },
    },
  });

  const executorReturning = (outcome: ExecOutcome, log: string[] = []): JobExecutor => ({
    executeJob: async (jobId: string) => {
      log.push(jobId);
      return outcome;
    },
  });

  it("normalizes a null needed job body before executing it", async () => {
    const entries = await expandWorkflowJobs(
      wfWith(null),
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: '["ts"]' } }),
    );
    expect(entries[1]).toMatchObject({ checkName: "Coverage (ts)", status: "run" });
  });
});
