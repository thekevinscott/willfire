import { describe, expect, it } from "vitest";
import { expandWorkflowJobs } from "./expandWorkflowJobs.js";
import type { ExecOutcome, JobExecutor } from "../execute/types.js";
import type { Scope } from "../expr/val.js";
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

  const expand = (jobs: unknown) =>
    expandWorkflowJobs(
      { on: { pull_request: null }, jobs } as never,
      { action: "opened", baseRef: "main", files: ["src/app.txt"] },
      readerOf(async () => null),
      SOURCE,
    );

  it("renders an object-valued matrix entry as its comma-joined values", async () => {
    const entries = await expand({
      m: { "runs-on": "ubuntu-latest", strategy: { matrix: { cfg: [{ os: "linux", arch: "x64" }] } } },
    });
    expect(entries.map((e) => e.checkName)).toEqual(["m (linux, x64)"]);
  });

  it("appends the matrix suffix to a literal name: that holds no expression", async () => {
    const entries = await expand({
      m: { "runs-on": "ubuntu-latest", name: "custom", strategy: { matrix: { a: ["x"] } } },
    });
    expect(entries.map((e) => e.checkName)).toEqual(["custom (x)"]);
  });

  it("names a skipped job after its id when it declares no name:", async () => {
    const entries = await expand({
      m: { "runs-on": "ubuntu-latest", if: false, strategy: { matrix: { a: ["x", "y"] } } },
    });
    expect(entries).toEqual([
      { job: "m", checkName: "m", status: "skipped", reason: "if: false" },
    ]);
  });

  // A skipped job is never set up, so `name:` is not interpolated: the check is
  // named with the expression text intact. Probe-verified (see
  // `skippedDisplayName`).
  it("leaves a skipped job's name: uninterpolated", async () => {
    const entries = await expand({
      m: { "runs-on": "ubuntu-latest", if: false, name: "sk ${{ github.event_name }}" },
    });
    expect(entries.map((e) => e.checkName)).toEqual(["sk ${{ github.event_name }}"]);
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

// The fleet shape, end to end: a `detect` job writes JSON to `$GITHUB_OUTPUT`,
// and the jobs downstream of it take both their `if:` and their matrix from
// what it wrote. Nothing here works out what `detect` writes — the outputs are
// handed in, which is the whole point of the seam.
describe("a matrix taken from another job's outputs", () => {
  const SOURCE = { owner: "o", repo: "r", ref: SHA, sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.txt"] };
  const NO_FETCH = async () => null;

  /** The fleet's `unit-coverage`, reduced to the two lines that matter. */
  const WORKFLOW = {
    on: { pull_request: null },
    jobs: {
      detect: { "runs-on": "ubuntu-latest", name: "Detect" },
      "unit-coverage": {
        "runs-on": "ubuntu-latest",
        name: "Unit-test coverage (${{ matrix.language }})",
        needs: "detect",
        if: "${{ needs.detect.outputs.langs != '[]' }}",
        strategy: { matrix: { language: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
      },
    },
  };

  const expand = (scope?: Scope) =>
    expandWorkflowJobs(WORKFLOW as never, CTX, readerOf(NO_FETCH), SOURCE, scope);

  it("names one check per value the output carries", async () => {
    const entries = await expand({ needs: { detect: { outputs: { langs: '["typescript"]' } } } });
    expect(entries).toEqual([
      { job: "Detect", checkName: "Detect", status: "run", reason: "" },
      {
        job: "Unit-test coverage (typescript)",
        checkName: "Unit-test coverage (typescript)",
        status: "run",
        reason: "if: \"${{ needs.detect.outputs.langs != '[]' }}\"",
      },
    ]);
  });

  it("collapses to the uninterpolated name when the output is empty", async () => {
    // The guard decides `skipped` first, and a skipped job never expands its
    // matrix or interpolates its `name:` — so GitHub creates one check called
    // exactly what the YAML says, expression text and all.
    const entries = await expand({ needs: { detect: { outputs: { langs: "[]" } } } });
    expect(entries.map((e) => e.checkName)).toEqual([
      "Detect",
      "Unit-test coverage (${{ matrix.language }})",
    ]);
    expect(entries[1].status).toBe("skipped");
  });

  it("stays one unknown entry when the outputs are not supplied", async () => {
    const entries = await expand();
    expect(entries[1]).toEqual({
      job: "unit-coverage",
      checkName: null,
      status: "unknown",
      reason: "dynamic matrix",
    });
  });

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
});

// A called workflow's guards are written against `inputs.*`, so expansion has
// to carry the caller's `with:` block across the call or every one of them is
// unknown. The job status below is the readout: `run` means the guard resolved
// true, `skipped` false, and `unknown` that the input never became a literal.
describe("caller inputs reaching a called workflow", () => {
  const SOURCE = { owner: "o", repo: "r", ref: "main", sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.txt"] };

  /**
   * A called workflow, as the text `fetchWorkflow` hands back. JSON is valid
   * YAML, so serializing the document is enough — and it keeps this suite from
   * importing `yaml`, which a unit test has no business reaching for.
   */
  const calleeDoc = (doc: Record<string, unknown>) => JSON.stringify(doc);

  const call = async (
    withBlock: unknown,
    cond: string,
    calleeOn: unknown = { workflow_call: { inputs: { x: { type: "string" } } } },
    onKey = "on",
  ) => {
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: { c: { uses: "./.github/workflows/callee.yml", with: withBlock } },
      } as never,
      CTX,
      readerOf(async () =>
        calleeDoc({
          ...(calleeOn === undefined ? {} : { [onKey]: calleeOn }),
          jobs: { inner: { "runs-on": "ubuntu-latest", if: cond } },
        }),
      ),
      SOURCE,
    );
    return entries[0];
  };

  it("resolves a guard against a literal string the caller passed", async () => {
    expect((await call({ x: "v" }, "inputs.x == 'v'")).status).toBe("run");
    expect((await call({ x: "w" }, "inputs.x == 'v'")).status).toBe("skipped");
  });

  it("resolves a boolean and a number", async () => {
    expect((await call({ x: true }, "inputs.x")).status).toBe("run");
    expect((await call({ x: false }, "inputs.x")).status).toBe("skipped");
    expect((await call({ x: 1 }, "inputs.x")).status).toBe("run");
    expect((await call({ x: 0 }, "inputs.x")).status).toBe("skipped");
  });

  it("reads an explicitly null value as the empty string", async () => {
    expect((await call({ x: null }, "inputs.x == ''")).status).toBe("run");
  });

  it("leaves a templated value unknown rather than guessing at it", async () => {
    // Resolving `${{ }}` here would mean evaluating the caller's own context.
    // Every caller in the fleet passes plain literals, so the unknown costs
    // nothing and the guess would cost correctness.
    expect((await call({ x: "${{ github.ref }}" }, "inputs.x == 'v'")).status).toBe("unknown");
  });

  it("leaves a structured value unknown", async () => {
    // `with:` takes scalars. A map or a sequence is not something the callee
    // could compare against a string anyway.
    expect((await call({ x: { nested: true } }, "inputs.x == 'v'")).status).toBe("unknown");
    expect((await call({ x: ["a"] }, "inputs.x == 'v'")).status).toBe("unknown");
  });

  it("falls back to the input's declared default when the caller omits it", async () => {
    const on = { workflow_call: { inputs: { x: { type: "string", default: "d" } } } };
    expect((await call({}, "inputs.x == 'd'", on)).status).toBe("run");
    // The caller still wins where it does supply a value.
    expect((await call({ x: "v" }, "inputs.x == 'd'", on)).status).toBe("skipped");
  });

  it("leaves a declared input with no default unknown rather than empty", async () => {
    // Guessing `''` here would silently decide a guard the workflow left open.
    expect((await call({}, "inputs.x == ''")).status).toBe("unknown");
  });

  it("tolerates a with: block that is not a mapping", async () => {
    expect((await call("not-a-mapping", "inputs.x == ''")).status).toBe("unknown");
    expect((await call(undefined, "inputs.x == ''")).status).toBe("unknown");
  });

  it("reads the inputs block under a YAML 1.1 `on` parsed as true", async () => {
    // A YAML 1.1 parser reads the `on:` key as boolean true. Expansion has to
    // find the inputs under either spelling.
    const on = { workflow_call: { inputs: { x: { type: "string", default: "d" } } } };
    expect((await call({}, "inputs.x == 'd'", on, "true")).status).toBe("run");
  });

  it.each([
    ["a callee with no on: block", undefined],
    ["an on: block that is not a mapping", "pull_request"],
    ["an on: block with no workflow_call", { pull_request: null }],
    ["a workflow_call that is not a mapping", { workflow_call: "yes" }],
    ["a workflow_call with no inputs", { workflow_call: null }],
    ["an inputs block that is not a mapping", { workflow_call: { inputs: "x" } }],
  ] as const)("still carries the caller's values past %s", async (_label, on) => {
    expect((await call({ x: "v" }, "inputs.x == 'v'", on)).status).toBe("run");
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

  it("resolves a dynamic matrix from what the needed job produced", async () => {
    const entries = await expandWorkflowJobs(
      wfWith({}),
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: '["ts", "py"]' } }),
    );
    expect(entries).toEqual([
      { job: "detect", checkName: "detect", status: "run", reason: "" },
      { job: "Coverage (ts)", checkName: "Coverage (ts)", status: "run", reason: "" },
      { job: "Coverage (py)", checkName: "Coverage (py)", status: "run", reason: "" },
    ]);
  });

  it("schedules nothing for a matrix the execution resolved to empty", async () => {
    const entries = await expandWorkflowJobs(
      wfWith({}),
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: "[]" } }),
    );
    // Zero combinations is a real answer: the job creates no check at all,
    // which is exactly what GitHub does with an empty axis.
    expect(entries).toEqual([{ job: "detect", checkName: "detect", status: "run", reason: "" }]);
  });

  it("threads an execution failure into the reasons of what needed it", async () => {
    const entries = await expandWorkflowJobs(
      wfWith({}),
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: false, reason: "step 's': exited 1" }),
    );
    expect(entries[1]).toEqual({
      job: "cover",
      checkName: null,
      status: "unknown",
      reason: "dynamic matrix; executing 'detect' failed: step 's': exited 1",
    });
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

  it("does not execute a needed job that would not run", async () => {
    const log: string[] = [];
    const entries = await expandWorkflowJobs(
      wfWith({ if: "false" }),
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: '["ts"]' } }, log),
    );
    expect(log).toEqual([]);
    // The consumer collapses the way a skipped dependency always does,
    // keeping its unresolved name the way every skipped matrix job does.
    expect(entries[1]).toMatchObject({
      job: "Coverage (${{ matrix.language }})",
      status: "skipped",
    });
  });

  it("executes a needed job whose guard the caller's scope decides", async () => {
    const log: string[] = [];
    const entries = await expandWorkflowJobs(
      wfWith({ if: "github.repository == 'o/r'" }),
      CTX,
      reader,
      SOURCE,
      { github: { repository: "o/r" } },
      executorReturning({ ok: true, outputs: { langs: '["ts"]' } }, log),
    );
    expect(log).toEqual(["detect"]);
    expect(entries[1]).toMatchObject({ checkName: "Coverage (ts)", status: "run" });
  });

  it("threads a failure into a dynamic matrix on a reusable call too", async () => {
    const wf = {
      on: { pull_request: null },
      jobs: {
        detect: {},
        call: {
          needs: "detect",
          uses: "./.github/workflows/sub.yml",
          strategy: { matrix: { l: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
        },
      },
    };
    const entries = await expandWorkflowJobs(
      wf,
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: false, reason: "boom" }),
    );
    expect(entries[1]).toEqual({
      job: "call",
      checkName: null,
      status: "unknown",
      reason: "dynamic matrix on reusable workflow call; executing 'detect' failed: boom",
    });
  });

  it("reaches a needed job inside a called workflow", async () => {
    // The recursion is where the callee's producer gets picked up and executed.
    const sub = JSON.stringify(wfWith({}));
    const entries = await expandWorkflowJobs(
      {
        on: { pull_request: null },
        jobs: { call: { uses: "./.github/workflows/sub.yml" } },
      },
      CTX,
      readerOf(async () => sub),
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: '["ts"]' } }),
    );
    expect(entries.map((e) => e.checkName)).toEqual([
      "call / detect",
      "call / Coverage (ts)",
    ]);
  });
});
