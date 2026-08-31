import { describe, expect, it, vi } from "vitest";
import { expandJobs } from "./expandJobs.js";
import type { Scope } from "../expr/val.js";

// The isolation gate wants collaborators mocked; input resolution and job
// selection are part of the expansion this suite pins, so the mocks pass the
// real modules through.
vi.mock(
  "./calleeInputs.js",
  async () => await vi.importActual<typeof import("./calleeInputs.js")>("./calleeInputs.js"),
);
vi.mock(
  "./neededJobIds.js",
  async () => await vi.importActual<typeof import("./neededJobIds.js")>("./neededJobIds.js"),
);
import type { JobExecutor } from "../execute.js";
import type {
  Ctx,
  FetchWorkflow,
  ResolveRef,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";
import type { YamlMap } from "../yamlValue.js";

/**
 * A 40-hex commit id, so anything pinned to it is already resolved.
 *
 * The literal matters: expansion decides whether to resolve a ref by its
 * *shape*, so a fixture ref has to look like the real thing or it takes the
 * other branch.
 */
const SHA = "a".repeat(40);

/** A commit in some other repo, spelled the full 40 hex digits. */
const REMOTE_SHA = "b".repeat(40);

const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const CTX: Ctx = { action: "opened", baseRef: "main", files: ["src/app.ts"] };

/**
 * Bundle a bare fetch as the reader expansion takes. The default resolver is
 * the identity — every ref is its own commit — which is right for fixtures
 * that never call across repos. Tests about resolution pass their own.
 */
const readerOf = (
  fetchWorkflow: FetchWorkflow,
  resolveRef: ResolveRef = async (src) => src.ref,
): WorkflowReader => ({ fetchWorkflow, resolveRef });

/** A reader over callee documents keyed by repo path (no leading `./`). */
const readerFor = (files: Record<string, string>) =>
  readerOf(async (path) => files[path] ?? null);

const expand = (jobs: YamlMap, reader: WorkflowReader = readerFor({})) =>
  expandJobs({ on: { pull_request: null }, jobs } as Workflow, CTX, reader, SOURCE);

/** The same expansion with an executor wired in, scope starting empty. */
const expandWith = (
  jobs: YamlMap,
  executor: JobExecutor,
  reader: WorkflowReader = readerFor({}),
) =>
  expandJobs(
    { on: { pull_request: null }, jobs } as Workflow,
    CTX,
    reader,
    SOURCE,
    0,
    "",
    true,
    {},
    executor,
  );

describe("job expansion", () => {
  it("decides job guards against the scope the caller handed in", async () => {
    // The scope param is the expr module's own Scope, threaded into evalIf.
    const scope: Scope = { inputs: { x: { kind: "value", v: "v" } } };
    const entries = await expandJobs(
      { on: { pull_request: null }, jobs: { a: { if: "inputs.x == 'v'" } } } as Workflow,
      CTX,
      readerFor({}),
      SOURCE,
      0,
      "",
      true,
      scope,
    );
    expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: `if: "inputs.x == 'v'"` }]);
  });

  it("expands a workflow with no jobs block to no entries", async () => {
    const entries = await expandJobs(
      { on: { pull_request: null } } as Workflow,
      CTX,
      readerFor({}),
      SOURCE,
    );
    expect(entries).toEqual([]);
  });

  it("tolerates a job whose body is empty", async () => {
    const entries = await expand({ a: null });
    expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: "" }]);
  });

  it("uses an explicit job name over the job id", async () => {
    const entries = await expand({ a: { name: "Build" } });
    expect(entries[0]).toMatchObject({ job: "Build" });
  });

  it("falls back to the job id when `name` is present but null", async () => {
    const entries = await expand({ a: { name: null } });
    expect(entries[0]).toMatchObject({ job: "a" });
  });

  it("records a job-level `if` as the entry reason", async () => {
    const entries = await expand({ a: { if: false } });
    expect(entries[0]).toMatchObject({ job: "a", status: "skipped", reason: "if: false" });
  });

  it("treats an `if:` left empty as absent", async () => {
    // YAML `if:` with no value parses to null; the guard is absent, not false.
    const entries = await expand({ a: { if: null } });
    expect(entries[0]).toMatchObject({ job: "a", status: "run", reason: "" });
  });

  describe("needs", () => {
    it("skips a job that needs a skipped job", async () => {
      const entries = await expand({ a: { if: false }, b: { needs: ["a"] } });
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "skipped"],
        ["b", "skipped"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' which is skipped");
    });

    it("accepts a scalar `needs`", async () => {
      const entries = await expand({ a: { if: false }, b: { needs: "a" } });
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped" });
    });

    it("propagates an unknown upstream status", async () => {
      const entries = await expand({
        a: { if: "needs.x.outputs.y == 'z'" },
        b: { needs: ["a"] },
      });
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "unknown"],
        ["b", "unknown"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' whose status is unknown");
    });

    it("leaves an already-unknown job unknown rather than restating why", async () => {
      const entries = await expand({
        a: { if: "github.ref == 'x'" },
        b: { if: "github.ref == 'y'", needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({
        job: "b",
        status: "unknown",
        reason: "if: \"github.ref == 'y'\"",
      });
    });

    it("does not propagate upstream status through always()", async () => {
      const entries = await expand({
        a: { if: false },
        b: { if: "always()", needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({ job: "b", status: "run" });
    });

    it("leaves an already-skipped job alone rather than re-deriving it", async () => {
      const entries = await expand({
        a: { if: false },
        b: { if: false, needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped", reason: "if: false" });
    });
  });

  describe("matrix", () => {
    it("names one entry per combination", async () => {
      const entries = await expand({ a: { strategy: { matrix: { os: ["linux", "mac"] } } } });
      expect(entries.map((e) => e.job)).toEqual(["a (linux)", "a (mac)"]);
    });

    it("substitutes matrix values into an explicit job name", async () => {
      const entries = await expand({
        a: { name: "build ${{ matrix.os }}", strategy: { matrix: { os: ["linux", "mac"] } } },
      });
      expect(entries.map((e) => e.job)).toEqual(["build linux", "build mac"]);
    });

    it("leaves an unset matrix key in place rather than guessing at it", async () => {
      // #9 stopped rendering an unevaluable expression as the empty string. It
      // survives into the name verbatim and nulls `checkName` instead: a wrong
      // name reads as a MISS against a check that really ran, whereas an absent
      // one is something verify.ts can report as unresolved and move on.
      const entries = await expand({
        a: { name: "build ${{ matrix.nope }}", strategy: { matrix: { os: ["linux"] } } },
      });
      expect(entries[0]).toMatchObject({
        job: "build ${{ matrix.nope }}",
        checkName: null,
      });
    });

    it("evaluates github.event_name, the one expression this can decide", async () => {
      // Expansion only ever answers for a pull_request dispatch, so this
      // expression is knowable and the name stays resolved.
      const entries = await expand({ a: { name: "on ${{ github.event_name }}" } });
      expect(entries[0]).toMatchObject({
        job: "on pull_request",
        checkName: "on pull_request",
      });
    });

    it("renders a null matrix value as nothing and a list value as a joined run", async () => {
      // The parenthetical is built from the raw value, whatever shape it has.
      // A null renders as the empty string rather than "null", and a list
      // flattens the same way an object does.
      const entries = await expand({ a: { strategy: { matrix: { v: [null, [1, 2]] } } } });
      expect(entries.map((e) => e.job)).toEqual(["a ()", "a (1, 2)"]);
    });

    it("omits the parenthetical when a combination has no keys to show", async () => {
      // An empty `include:` entry with no axes to attach to becomes a
      // combination of its own with nothing in it. One check, bare job id.
      const entries = await expand({ a: { strategy: { matrix: { include: [{}] } } } });
      expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: "" }]);
    });

    it("cannot resolve a matrix expression on a job that has no matrix", async () => {
      // `${{ matrix.* }}` outside a matrix is nothing we can substitute, so the
      // name stays unresolved rather than collapsing to an empty parenthetical.
      const entries = await expand({ a: { name: "build ${{ matrix.os }}" } });
      expect(entries[0]).toMatchObject({
        job: "build ${{ matrix.os }}",
        checkName: null,
        status: "run",
      });
    });

    it("reports a dynamic matrix as unknown", async () => {
      const entries = await expand({
        a: { strategy: { matrix: "${{ fromJSON(needs.x.outputs.m) }}" } },
      });
      expect(entries[0]).toMatchObject({
        job: "a",
        status: "unknown",
        reason: "dynamic matrix",
      });
    });
  });
});

describe("reusable workflows", () => {
  const SUB = ".github/workflows/sub.yml";
  const SUB2 = ".github/workflows/sub2.yml";

  it("inlines the called workflow's jobs under a prefixed name", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: { name: "Inner" } } }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["call / Inner", "run"]]);
  });

  it("prefixes with the caller job's own name when it has one", async () => {
    const entries = await expand(
      { call: { name: "Called", uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } }),
      }),
    );
    expect(entries.map((e) => e.job)).toEqual(["Called / inner"]);
  });

  it("follows a nested call and keeps prefixing", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({
          on: { workflow_call: null },
          jobs: { mid: { uses: "./.github/workflows/sub2.yml" } },
        }),
        [SUB2]: JSON.stringify({ on: { workflow_call: null }, jobs: { deep: {} } }),
      }),
    );
    expect(entries).toEqual([
      { job: "call / mid / deep", checkName: "call / mid / deep", status: "run", reason: "" },
    ]);
  });

  it("gives up past the four-level call chain GitHub allows", async () => {
    // Not a self-imposed budget: a fifth level fails the run outright, so
    // there is no check name to predict. Level five is the first `uses:` we
    // decline to follow, and the entry stops at the caller that made it.
    const link = (next: string) =>
      JSON.stringify({
        on: { workflow_call: null },
        jobs: { j: { uses: `./.github/workflows/${next}` } },
      });
    const entries = await expand(
      { call: { uses: "./.github/workflows/n1.yml" } },
      readerFor({
        ".github/workflows/n1.yml": link("n2.yml"),
        ".github/workflows/n2.yml": link("n3.yml"),
        ".github/workflows/n3.yml": link("n4.yml"),
        ".github/workflows/n4.yml": link("n5.yml"),
        ".github/workflows/n5.yml": JSON.stringify({
          on: { workflow_call: null },
          jobs: { leaf: {} },
        }),
      }),
    );
    expect(entries).toEqual([
      {
        job: "call / j / j / j / j",
        checkName: null,
        status: "unknown",
        reason: "reusable workflow nested deeper than 4 levels",
      },
    ]);
  });

  it("reports a dynamic matrix on the calling job as unknown", async () => {
    // The caller's matrix multiplies the whole callee set, so an unknown
    // multiplier makes the entire subtree unpredictable: one unknown entry
    // for the calling job, and the callee is never fetched at all.
    const fetched: string[] = [];
    const entries = await expand(
      {
        call: {
          uses: "./.github/workflows/sub.yml",
          strategy: { matrix: "${{ fromJSON(needs.x.outputs.m) }}" },
        },
      },
      readerOf(async (path) => {
        fetched.push(path);
        return JSON.stringify({ on: { workflow_call: null } });
      }),
    );
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix on reusable workflow call",
      },
    ]);
    expect(fetched).toEqual([]);
  });

  it("reports a callee that does not parse as unknown", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({ [SUB]: "jobs:\n  a: [unclosed\n" }),
    );
    expect(entries[0]).toMatchObject({ job: "call", checkName: null, status: "unknown" });
    expect(entries[0].reason).toMatch(
      /^YAML parse error in \.\/\.github\/workflows\/sub\.yml: /,
    );
  });

  it("reports a callee that parses to nothing as unresolvable", async () => {
    // An empty file is not a fetch failure and not a parse error: it parses
    // cleanly to null. There is still no workflow to expand, so the call has
    // to land somewhere rather than fall through as a resolved zero-job set.
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({ [SUB]: "" }),
    );
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "cannot resolve ./.github/workflows/sub.yml",
      },
    ]);
  });

  it("nulls the name of a skipped job inside an unresolvable caller", async () => {
    // A skipped job's own name is always resolved — nothing about it is
    // evaluated. The prefix is what is missing here, and an unresolved prefix
    // has to poison the whole subtree, skipped entries included.
    const entries = await expand(
      { call: { name: "${{ inputs.flavour }}", uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: { if: false } } }),
      }),
    );
    expect(entries[0]).toMatchObject({
      job: "${{ inputs.flavour }} / inner",
      checkName: null,
      status: "skipped",
    });
  });

  // A cross-repo callee is reached in two steps: resolve the ref to a commit,
  // then read the file at it. Either step can fail, and they fail differently,
  // so each has its own case. The path where both succeed is pinned against
  // live dispatches in tests/integration/names.test.ts.
  it("reports a cross-repo reusable whose ref will not resolve", async () => {
    // The resolver answers null the way a deleted tag or a private repo does.
    // Falling back to reading the mutable ref is exactly what must not happen:
    // the answer would be unnameable afterwards.
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => null,
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: `cannot resolve ref for ${uses}`,
    });
  });

  it("reports a cross-repo reusable it resolved but cannot fetch", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => REMOTE_SHA,
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: `cannot fetch ${uses}`,
    });
  });

  it("skips resolution for a `uses:` already pinned to a commit", async () => {
    // Nothing to look up: the ref is the commit. Asking anyway would spend a
    // request per call site on an answer already written down.
    const uses = `octo/repo/.github/workflows/x.yml@${REMOTE_SHA}`;
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => {
          throw new Error("resolution must not run for a pinned sha");
        },
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      // `cannot fetch`, not `cannot resolve`: resolution never ran, and this
      // fixture serves no file that would have let the fetch succeed.
      reason: `cannot fetch ${uses}`,
    });
  });

  it("reports a local reusable that is missing at head", async () => {
    const entries = await expand({ call: { uses: "./.github/workflows/sub.yml" } });
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: "cannot fetch ./.github/workflows/sub.yml",
    });
  });

  it("skips a caller job whose `if` is false without expanding it", async () => {
    const fetched: string[] = [];
    const entries = await expand(
      { call: { if: false, uses: "./.github/workflows/sub.yml" } },
      readerOf(async (path) => {
        fetched.push(path);
        return JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } });
      }),
    );
    expect(entries).toEqual([
      { job: "call", checkName: "call", status: "skipped", reason: "if: false" },
    ]);
    expect(fetched).toEqual([]);
  });

  it("reports a uses: it cannot turn into a fetch target", async () => {
    const entries = await expand({ call: { uses: "not-a-reference" } });
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: "unresolvable reusable reference: not-a-reference",
    });
  });
});

describe("derived execution", () => {
  /** An executor that records what it is asked to run and answers `outputs`. */
  const recording = (outputs: Record<string, string>) => {
    const executed: string[] = [];
    const executor: JobExecutor = {
      executeJob: async (jobId) => {
        executed.push(jobId);
        return { ok: true, outputs };
      },
    };
    return { executed, executor };
  };

  it("executes exactly the jobs a sibling reads outputs from", async () => {
    const { executed, executor } = recording({ langs: '["ts","py"]' });
    const entries = await expandWith(
      {
        detect: { steps: [] },
        helper: { steps: [] },
        cover: {
          needs: "detect",
          strategy: { matrix: { lang: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
        },
      },
      executor,
    );
    expect(executed).toEqual(["detect"]);
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["detect", "run"],
      ["helper", "run"],
      ["cover (ts)", "run"],
      ["cover (py)", "run"],
    ]);
  });

  it("never executes a reusable-call job, even when a sibling reads its outputs", async () => {
    // A call job has no steps of its own; its outputs come from the callee's
    // jobs, which execution does not model. The read stays unresolved.
    const { executed, executor } = recording({});
    const entries = await expandWith(
      {
        plan: { uses: "./.github/workflows/sub.yml" },
        build: { needs: "plan", if: "needs.plan.outputs.x == 'y'" },
      },
      executor,
      readerFor({
        ".github/workflows/sub.yml": JSON.stringify({
          on: { workflow_call: null },
          jobs: { inner: {} },
        }),
      }),
    );
    expect(executed).toEqual([]);
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["plan / inner", "run"],
      ["build", "unknown"],
    ]);
  });

  it("does not execute a needed job that is predicted not to run", async () => {
    const { executed, executor } = recording({ langs: '["ts"]' });
    const entries = await expandWith(
      {
        detect: { if: false, steps: [] },
        cover: {
          needs: "detect",
          strategy: { matrix: { lang: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
        },
      },
      executor,
    );
    expect(executed).toEqual([]);
    expect(entries.map((e) => [e.job, e.status, e.reason])).toEqual([
      ["detect", "skipped", "if: false"],
      ["cover", "skipped", "needs 'detect' which is skipped"],
    ]);
  });

  it("threads an execution failure into the entry that needed the outputs", async () => {
    const executor: JobExecutor = {
      executeJob: async () => ({ ok: false, reason: "docker not found" }),
    };
    const entries = await expandWith(
      {
        detect: { steps: [] },
        cover: {
          needs: "detect",
          strategy: { matrix: { lang: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
        },
      },
      executor,
    );
    expect(entries.map((e) => [e.job, e.status, e.reason])).toEqual([
      ["detect", "run", ""],
      ["cover", "unknown", "dynamic matrix; executing 'detect' failed: docker not found"],
    ]);
  });
});

describe("with: values across the call boundary", () => {
  const CALLEE = ".github/workflows/callee.yml";

  it("keeps a whole-expression value structured, so a computed matrix crosses the call", async () => {
    const executor: JobExecutor = {
      executeJob: async () => ({
        ok: true,
        outputs: { matrix: '[{"os":"linux"},{"os":"mac"}]' },
      }),
    };
    const entries = await expandWith(
      {
        plan: { steps: [] },
        build: {
          needs: "plan",
          uses: "./.github/workflows/callee.yml",
          with: { m: "${{ fromJSON(needs.plan.outputs.matrix) }}" },
        },
      },
      executor,
      readerFor({
        [CALLEE]: JSON.stringify({
          on: { workflow_call: { inputs: { m: { type: "string" } } } },
          jobs: { leg: { strategy: { matrix: { include: "${{ inputs.m }}" } } } },
        }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["plan", "run"],
      ["build / leg (linux)", "run"],
      ["build / leg (mac)", "run"],
    ]);
  });

  it("renders a mixed template to a string on the way across", async () => {
    const executor: JobExecutor = {
      executeJob: async () => ({ ok: true, outputs: { lang: "ts" } }),
    };
    const entries = await expandWith(
      {
        plan: { steps: [] },
        build: {
          needs: "plan",
          uses: "./.github/workflows/callee.yml",
          with: { flavour: "on-${{ needs.plan.outputs.lang }}" },
        },
      },
      executor,
      readerFor({
        [CALLEE]: JSON.stringify({
          on: { workflow_call: { inputs: { flavour: { type: "string" } } } },
          jobs: { leg: { if: "inputs.flavour == 'on-ts'" } },
        }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["plan", "run"],
      ["build / leg", "run"],
    ]);
  });

  it("passes literals through with their types and falls back to declared defaults", async () => {
    // Job ids mirror the input each guard reads: a–d literal from the caller,
    // e defaulted, f never passed (unknown, not empty), g–h malformed (unknown).
    const entries = await expand(
      {
        call: {
          uses: "./.github/workflows/callee.yml",
          with: { a: null, b: true, c: 5, d: "txt" },
        },
      },
      readerFor({
        [CALLEE]: JSON.stringify({
          on: {
            workflow_call: {
              inputs: {
                e: { default: "dflt" },
                f: { type: "string" },
                g: null,
                h: "string",
              },
            },
          },
          jobs: {
            a: { if: "inputs.a == ''" },
            b: { if: "inputs.b" },
            c: { if: "inputs.c == 5" },
            d: { if: "inputs.d == 'txt'" },
            e: { if: "inputs.e == 'dflt'" },
            f: { if: "inputs.f == 'x'" },
            g: { if: "inputs.g == 'x'" },
            h: { if: "inputs.h == 'x'" },
          },
        }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["call / a", "run"],
      ["call / b", "run"],
      ["call / c", "run"],
      ["call / d", "run"],
      ["call / e", "run"],
      ["call / f", "unknown"],
      ["call / g", "unknown"],
      ["call / h", "unknown"],
    ]);
  });

  it("leaves an unresolvable with: value unknown", async () => {
    // Whole-expression and mixed forms both read outputs nothing executed; a
    // structured value is nothing GitHub accepts in `with:` at all.
    for (const flag of ["${{ needs.plan.outputs.x }}", "x-${{ needs.plan.outputs.x }}", [1]]) {
      const entries = await expand(
        { call: { uses: "./.github/workflows/callee.yml", with: { flag } } },
        readerFor({
          [CALLEE]: JSON.stringify({
            on: { workflow_call: null },
            jobs: { leg: { if: "inputs.flag == 'x'" } },
          }),
        }),
      );
      expect(entries.map((e) => [e.job, e.status])).toEqual([["call / leg", "unknown"]]);
    }
  });

  it("treats a malformed or absent workflow_call block as no declared inputs", async () => {
    const jobs = { leg: { if: "inputs.q == 'x'" } };
    const shapes: YamlMap[] = [
      { jobs },
      { on: "push", jobs },
      // `on:` written with no value: YAML 1.1 reads the key as the boolean.
      { true: null, jobs },
      { on: { pull_request: null }, jobs },
      { on: { workflow_call: "yes" }, jobs },
      { on: { workflow_call: {} }, jobs },
      { on: { workflow_call: { inputs: null } }, jobs },
      { on: { workflow_call: { inputs: 5 } }, jobs },
    ];
    for (const shape of shapes) {
      const entries = await expand(
        { call: { uses: "./.github/workflows/callee.yml" } },
        readerFor({ [CALLEE]: JSON.stringify(shape) }),
      );
      expect(entries.map((e) => [e.job, e.status])).toEqual([["call / leg", "unknown"]]);
    }
  });

  it("treats a `with:` left empty as passing nothing", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/callee.yml", with: null } },
      readerFor({
        [CALLEE]: JSON.stringify({
          on: { workflow_call: { inputs: { e: { default: "x" } } } },
          jobs: { leg: { if: "inputs.e == 'x'" } },
        }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["call / leg", "run"]]);
  });

  it("reads the declared inputs when YAML 1.1 parsed `on:` as a boolean key", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/callee.yml" } },
      readerFor({
        [CALLEE]: JSON.stringify({
          true: { workflow_call: { inputs: { e: { default: "x" } } } },
          jobs: { leg: { if: "inputs.e == 'x'" } },
        }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["call / leg", "run"]]);
  });
});

describe("inputs the event never supplied", () => {
  const CALLEE = ".github/workflows/callee.yml";

  const withDispatchInput = (jobs: Record<string, unknown>): Workflow =>
    ({
      on: {
        pull_request: null,
        workflow_dispatch: { inputs: { version: { type: "string", default: "" } } },
      },
      jobs,
    }) as Workflow;

  it("decides a guard on an input a pull_request never carried", async () => {
    const entries = await expandJobs(
      withDispatchInput({ gate: { if: "inputs.version == ''" } }),
      CTX,
      readerFor({}),
      SOURCE,
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["gate", "run"]]);
  });

  it("keeps a binding the caller handed in over the absent one", async () => {
    const scope: Scope = { inputs: { version: { kind: "value", v: "1.2.3" } } };
    const entries = await expandJobs(
      withDispatchInput({ gate: { if: "inputs.version == '1.2.3'" } }),
      CTX,
      readerFor({}),
      SOURCE,
      0,
      "",
      true,
      scope,
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["gate", "run"]]);
  });

  it("forwards the empty binding into a callee's executed job (#125)", async () => {
    // The reported shape: a `workflow_dispatch` input absent on this event is
    // passed down a `with:`, and the callee's job execution reads it.
    const scopes: Scope[] = [];
    const executor: JobExecutor = {
      executeJob: async (_jobId, _job, _wf, scope) => {
        scopes.push(scope);
        return { ok: true, outputs: { langs: '["ts"]' } };
      },
    };
    const entries = await expandJobs(
      withDispatchInput({
        call: {
          uses: "./.github/workflows/callee.yml",
          with: { version: "${{ inputs.version }}" },
        },
      }),
      CTX,
      readerFor({
        [CALLEE]: JSON.stringify({
          on: { workflow_call: { inputs: { version: { type: "string" } } } },
          jobs: {
            detect: { steps: [] },
            static: {
              needs: "detect",
              strategy: { matrix: { lang: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
            },
          },
        }),
      }),
      SOURCE,
      0,
      "",
      true,
      {},
      executor,
    );
    expect(scopes.map((s) => s.inputs?.version)).toEqual([{ kind: "value", v: "" }]);
    expect(entries.map((e) => [e.job, e.status])).toEqual([
      ["call / detect", "run"],
      ["call / static (ts)", "run"],
    ]);
  });
});
