// Unit suite for the prediction engine.
//
// Two seams are exercised here. The pure helpers (`patternToRegex`,
// `matchFilters`, `expandMatrix`, `evalIf`) are called directly. Everything
// else — the workflow-level verdicts, job expansion, reusable-workflow
// recursion and the CLI — is driven through `predict()` against a hand-built
// Octokit stand-in, because those functions are module-private and the module
// is deliberately not being split while other work is in flight (see #10).
//
// The expectations are not opinions about how GitHub *ought* to behave. The
// workflow-level verdicts were settled in #7 against live dispatches on
// thekevinbot/willrun-probe, and the probe workflows under
// `tests/fixtures/willrun-probe/` are the record. Changing one of these
// assertions means claiming GitHub changed.

import type { Octokit } from "@octokit/rest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evalIf,
  expandMatrix,
  expandWorkflowJobs,
  makeOctokit,
  parseUses,
  matchFilters,
  patternToRegex,
  predict,
  type Entry,
  type ExpandedJob,
  type FetchWorkflow,
  type JobEntry,
  type Prediction,
  type ResolveRef,
  type WorkflowEntry,
  type WorkflowReader,
  type WorkflowSource,
} from "./predict.js";
import type { ExecOutcome } from "./execute.js";
import type { Scope } from "./expr.js";

// Compile-time only, checked by `tsc --noEmit` over this file rather than at
// run time. `expandJobs` is the sole producer of job entries, so the status a
// `JobEntry` can carry is exactly the status an `ExpandedJob` carries — and
// `no-dispatch`, a verdict about whether the run happens at all, belongs to
// the workflow level and nowhere else. Both drift silently without this.
type Assert<T extends true> = T;
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type _JobStatusIsWhatExpansionProduces = Assert<
  Eq<JobEntry["status"], ExpandedJob["status"]>
>;
type _JobStatusExcludesNoDispatch = Assert<
  Eq<Extract<JobEntry["status"], "no-dispatch">, never>
>;
type _NoDispatchLivesOnTheWorkflow = Assert<
  Eq<Extract<WorkflowEntry["status"], "no-dispatch">, "no-dispatch">
>;

/**
 * A 40-hex commit id, so anything pinned to it is already resolved.
 *
 * The literal matters: expansion decides whether to resolve a ref by its
 * *shape*, so a fixture ref has to look like the real thing or it takes the
 * other branch.
 */
const SHA = "a".repeat(40);

/**
 * Bundle a bare fetch as the reader expansion takes.
 *
 * The default resolver is the identity — every ref is its own commit — which
 * is right for fixtures that never call across repos. Tests about resolution
 * pass their own.
 */
const readerOf = (
  fetchWorkflow: FetchWorkflow,
  resolveRef: ResolveRef = async (src) => src.ref,
): WorkflowReader => ({ fetchWorkflow, resolveRef });

// The real `Octokit` constructor is the one third-party edge the module reaches
// for on its own (`makeOctokit`, and through it the CLI). Replacing the class
// lets both be driven without a network. `hoisted` is the handoff: `vi.mock`
// factories are lifted above the imports, so they cannot close over ordinary
// module scope.
const hoisted = vi.hoisted(() => ({
  octokit: undefined as unknown,
  authSeen: [] as (string | undefined)[],
}));

vi.mock("@octokit/rest", async () => {
  const actual = await vi.importActual<typeof import("@octokit/rest")>("@octokit/rest");
  return {
    ...actual,
    // Returning an object from a constructor overrides `this`, so `new Octokit()`
    // hands back whatever the case under test staged.
    Octokit: class {
      constructor(options: { auth?: string }) {
        hoisted.authSeen.push(options.auth);
        return (hoisted.octokit ?? {}) as object;
      }
    },
  };
});

// ------------------------------------------------------------------ fixtures

const WF = ".github/workflows/w.yml";
const SUB = ".github/workflows/sub.yml";
const SUB2 = ".github/workflows/sub2.yml";

interface Fixture {
  /** >1 makes the inferred event action `synchronize` rather than `opened`. */
  commits?: number;
  baseRef?: string;
  files?: string[];
  /** Head commit message — the surface the skip instructions are read from. */
  message?: string;
  workflows?: { path: string; state: string }[];
  /** Repo contents at head, keyed by path. A missing key is a 404. */
  contents?: Record<string, string>;
  /**
   * What a cross-repo ref resolves to, keyed `owner/repo@ref`. A ref that is
   * not listed 404s, which is the answer a deleted tag or a private repo gives.
   */
  refs?: Record<string, string>;
  /**
   * Tarball bytes by `owner/repo@ref`, for the executor's tree downloads. A
   * missing key throws, which is what the tarball endpoint does for anything
   * it will not serve.
   */
  tarballs?: Record<string, Uint8Array>;
}

/** The head commit of the PR every fixture describes. */
const HEAD_SHA = "deadbeef";

/** The one source every prediction reads, whatever else it reaches. */
const HEAD_SOURCE = { owner: "o", repo: "r", ref: HEAD_SHA, sha: HEAD_SHA };

/**
 * A commit in some other repo, spelled the full 40 hex digits.
 *
 * The length is the point: whether a ref needs resolving is decided by its
 * shape, so a short stand-in would take the other branch.
 */
const REMOTE_SHA = "b".repeat(40);

// Sentinels standing in for the paginating route methods. `predict` passes the
// method itself to `octokit.paginate`, never calls it, so identity is all the
// stub needs to tell the two routes apart.
const LIST_FILES = Symbol("pulls.listFiles");
const LIST_WORKFLOWS = Symbol("actions.listRepoWorkflows");

function fakeOctokit(f: Fixture): Octokit {
  const contents = f.contents ?? {};
  const api = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            commits: f.commits ?? 1,
            base: { ref: f.baseRef ?? "main" },
            head: { sha: HEAD_SHA },
          },
        }),
        listFiles: LIST_FILES,
      },
      repos: {
        getCommit: async ({ owner, repo, ref }: { owner: string; repo: string; ref: string }) => {
          // Two callers share this route: the head-commit read that looks for a
          // skip instruction, and ref resolution. Only the first has a message.
          if (ref === HEAD_SHA) {
            return { data: { sha: ref, commit: { message: f.message ?? "chore: routine" } } };
          }
          const sha = (f.refs ?? {})[`${owner}/${repo}@${ref}`];
          if (sha == null) throw new Error(`404 ${owner}/${repo}@${ref}`);
          return { data: { sha, commit: { message: "" } } };
        },
        getContent: async ({ path }: { path: string }) => {
          if (!(path in contents)) throw new Error(`404 ${path}`);
          return { data: contents[path] };
        },
        downloadTarballArchive: async ({ owner, repo, ref }: Record<string, string>) => {
          const bytes = (f.tarballs ?? {})[`${owner}/${repo}@${ref}`];
          if (bytes == null) throw new Error(`404 tarball ${owner}/${repo}@${ref}`);
          return { data: bytes.buffer };
        },
      },
      actions: { listRepoWorkflows: LIST_WORKFLOWS },
    },
    paginate: async (route: symbol) => {
      if (route === LIST_FILES) {
        return (f.files ?? ["src/app.ts"]).map((filename) => ({ filename }));
      }
      return f.workflows ?? [{ path: WF, state: "active" }];
    },
  };
  return api as unknown as Octokit;
}

/** Predict against a repo whose only workflow is `body` at `.github/workflows/w.yml`. */
function run(body: string, f: Fixture = {}): Promise<Prediction> {
  return predict(fakeOctokit({ contents: { [WF]: body }, ...f }), "o/r", 1);
}

/** The single entry `run()` produced, asserting there is exactly one. */
async function only(body: string, f: Fixture = {}): Promise<Entry> {
  const { entries } = await run(body, f);
  expect(entries).toHaveLength(1);
  return entries[0];
}

// ---------------------------------------------------------- pattern matching

describe("patternToRegex", () => {
  it("anchors the whole value", () => {
    const re = patternToRegex("main");
    expect(re.test("main")).toBe(true);
    expect(re.test("mainline")).toBe(false);
    expect(re.test("releases/main")).toBe(false);
  });

  it("treats a single * as any run of non-separator characters", () => {
    const re = patternToRegex("src/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/nested/app.ts")).toBe(false);
  });

  it("treats ** as any run of characters, separators included", () => {
    const re = patternToRegex("src/**");
    expect(re.test("src/nested/app.ts")).toBe(true);
  });

  it("passes ? through as zero-or-one of the preceding character", () => {
    const re = patternToRegex("releases?");
    expect(re.test("release")).toBe(true);
    expect(re.test("releases")).toBe(true);
    expect(re.test("releasess")).toBe(false);
  });

  it("passes + through as one-or-more of the preceding character", () => {
    const re = patternToRegex("v1+");
    expect(re.test("v1")).toBe(true);
    expect(re.test("v111")).toBe(true);
    expect(re.test("v")).toBe(false);
  });

  it("passes a character range through untouched", () => {
    const re = patternToRegex("v[0-9]");
    expect(re.test("v7")).toBe(true);
    expect(re.test("vx")).toBe(false);
  });

  it("escapes regex metacharacters that are literal in the glob grammar", () => {
    const re = patternToRegex("v1.0");
    expect(re.test("v1.0")).toBe(true);
    expect(re.test("v1x0")).toBe(false);
  });

  it("takes a backslash as escaping the next character", () => {
    const re = patternToRegex(String.raw`a\*b`);
    expect(re.test("a*b")).toBe(true);
    expect(re.test("axb")).toBe(false);
  });
});

describe("matchFilters", () => {
  it("is false when nothing matches", () => {
    expect(matchFilters("main", ["releases/*"])).toBe(false);
  });

  it("is true on a plain match", () => {
    expect(matchFilters("releases/v1", ["releases/*"])).toBe(true);
  });

  it("lets the last matching pattern win", () => {
    expect(matchFilters("main", ["**", "!main"])).toBe(false);
    expect(matchFilters("main", ["!main", "**"])).toBe(true);
  });

  it("ignores a negation that does not match", () => {
    expect(matchFilters("main", ["**", "!dev"])).toBe(true);
  });
});

// ------------------------------------------------------- workflow-level verdicts

describe("workflow-level verdicts", () => {
  it("declines a workflow with no `on` key", async () => {
    expect(await only("jobs:\n  a:\n    runs-on: ubuntu-latest\n")).toMatchObject({
      job: "*",
      status: "no-dispatch",
      reason: "no pull_request trigger",
    });
  });

  it("declines a workflow whose `on` is an unusable scalar", async () => {
    // `on: true` — YAML 1.2 keeps the key a string and the value a boolean, so
    // there is no trigger map to read.
    expect(await only("on: true\njobs:\n  a: {}\n")).toMatchObject({
      status: "no-dispatch",
      reason: "no pull_request trigger",
    });
  });

  it("reads the YAML 1.1 boolean-key spelling of `on`", async () => {
    // A parser that folds `on:` to boolean `true` leaves the trigger under the
    // key `true`. The fallback keeps such a file readable.
    const wf = "? true\n: pull_request:\njobs:\n  a:\n    runs-on: ubuntu-latest\n";
    expect(await only(wf)).toMatchObject({ job: "a", status: "run" });
  });

  it("accepts a string `on`", async () => {
    expect(await only("on: pull_request\njobs:\n  a: {}\n")).toMatchObject({ job: "a" });
  });

  it("declines a string `on` naming another event", async () => {
    expect(await only("on: push\njobs:\n  a: {}\n")).toMatchObject({
      reason: "no pull_request trigger",
    });
  });

  it("accepts a list `on` containing pull_request", async () => {
    expect(await only("on: [push, pull_request]\njobs:\n  a: {}\n")).toMatchObject({
      job: "a",
    });
  });

  it("declines a list `on` without pull_request", async () => {
    expect(await only("on: [push]\njobs:\n  a: {}\n")).toMatchObject({
      reason: "no pull_request trigger",
    });
  });

  it("declines a map `on` without pull_request", async () => {
    expect(await only("on:\n  push:\njobs:\n  a: {}\n")).toMatchObject({
      reason: "no pull_request trigger",
    });
  });

  it("declines an event action outside the declared types", async () => {
    const wf = "on:\n  pull_request:\n    types: [labeled]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({
      status: "no-dispatch",
      reason: "action 'opened' not in types [labeled]",
    });
  });

  it("infers `synchronize` once the PR has more than one commit", async () => {
    const wf = "on:\n  pull_request:\n    types: [opened]\njobs:\n  a: {}\n";
    expect(await only(wf, { commits: 3 })).toMatchObject({
      reason: "action 'synchronize' not in types [opened]",
    });
  });

  // ---- the four verdicts settled in #7 ----

  // Both-filters is invalid config. GitHub does not fall back to "no filter"
  // and does not skip the workflow: it creates the run and concludes
  // `startup_failure`. The run exists, so the workflow dispatches — and #7
  // deliberately lets job expansion proceed from there rather than emit a bare
  // `job: "*"` entry. The startup-failed run really has no job checks, so these
  // entries over-predict at job granularity; at workflow-run granularity (what
  // pr-monitor compares on) it collapses to the same answer, and the shape
  // appears in zero fleet repos. Asserted here so the tradeoff stays visible.

  it("dispatches when both `branches` and `branches-ignore` are set (#7)", async () => {
    const wf =
      "on:\n  pull_request:\n    branches: [main]\n    branches-ignore: [main]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({
      job: "a",
      status: "run",
      reason: "both branches and branches-ignore set: startup failure",
    });
  });

  it("dispatches when both `paths` and `paths-ignore` are set (#7)", async () => {
    const wf =
      "on:\n  pull_request:\n    paths: ['**']\n    paths-ignore: ['**']\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({
      job: "a",
      status: "run",
      reason: "both paths and paths-ignore set: startup failure",
    });
  });

  it("checks the conflicting filters before evaluating either one", async () => {
    // `branches: [dev]` alone would decline on a `main` base, and
    // `paths: [docs/**]` alone would decline on a `src/` diff. The
    // startup-failure verdict has to win over both.
    const wf =
      "on:\n  pull_request:\n    branches: [dev]\n    branches-ignore: [dev]\njobs:\n  a: {}\n";
    expect(await only(wf, { baseRef: "main" })).toMatchObject({ status: "run" });
  });

  it("reports a workflow with no file at head as no-dispatch (#7)", async () => {
    // The Actions API keeps listing a workflow as `active` after its file is
    // deleted on the branch. Nothing can dispatch from a file that is not there.
    const { entries } = await predict(
      fakeOctokit({ contents: {} }),
      "o/r",
      1,
    );
    expect(entries).toEqual([
      {
        workflow: WF,
        job: "*",
        checkName: null,
        status: "no-dispatch",
        reason: "no workflow file at head",
      },
    ]);
  });

  it("reports an unparseable workflow as a workflow-level run (#7)", async () => {
    // GitHub creates the run and concludes it `startup_failure`. The run exists
    // but has no jobs, so there is a workflow-level entry and nothing to expand.
    const entry = await only("on: pull_request\njobs:\n  a: [\n");
    expect(entry.job).toBe("*");
    expect(entry.status).toBe("run");
    expect(entry.reason).toMatch(/^YAML parse error: /);
  });

  // ---- branch and path filters ----

  it("declines a base branch outside `branches`", async () => {
    const wf = "on:\n  pull_request:\n    branches: [releases/*]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({
      status: "no-dispatch",
      reason: "base branch 'main' not in branches",
    });
  });

  it("accepts a base branch inside `branches`", async () => {
    const wf = "on:\n  pull_request:\n    branches: [main]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({ job: "a", status: "run" });
  });

  it("declines a base branch inside `branches-ignore`", async () => {
    const wf = "on:\n  pull_request:\n    branches-ignore: [main]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({
      status: "no-dispatch",
      reason: "base branch in branches-ignore",
    });
  });

  it("accepts a base branch outside `branches-ignore`", async () => {
    const wf = "on:\n  pull_request:\n    branches-ignore: [dev]\njobs:\n  a: {}\n";
    expect(await only(wf)).toMatchObject({ job: "a" });
  });

  it("declines when no changed file matches `paths`", async () => {
    const wf = "on:\n  pull_request:\n    paths: ['docs/**']\njobs:\n  a: {}\n";
    expect(await only(wf, { files: ["src/app.ts"] })).toMatchObject({
      status: "no-dispatch",
      reason: "no changed file matches paths",
    });
  });

  it("accepts when one changed file matches `paths`", async () => {
    const wf = "on:\n  pull_request:\n    paths: ['docs/**']\njobs:\n  a: {}\n";
    expect(await only(wf, { files: ["src/app.ts", "docs/a.md"] })).toMatchObject({
      job: "a",
    });
  });

  it("declines when every changed file matches `paths-ignore`", async () => {
    const wf = "on:\n  pull_request:\n    paths-ignore: ['docs/**']\njobs:\n  a: {}\n";
    expect(await only(wf, { files: ["docs/a.md", "docs/b.md"] })).toMatchObject({
      status: "no-dispatch",
      reason: "all changed files match paths-ignore",
    });
  });

  it("accepts when one changed file escapes `paths-ignore`", async () => {
    const wf = "on:\n  pull_request:\n    paths-ignore: ['docs/**']\njobs:\n  a: {}\n";
    expect(await only(wf, { files: ["docs/a.md", "src/app.ts"] })).toMatchObject({
      job: "a",
    });
  });
});

// ------------------------------------------------------------- repo-level pipeline

describe("predict", () => {
  it("reports a disabled workflow as no-dispatch without reading the file", async () => {
    const octokit = fakeOctokit({
      workflows: [{ path: WF, state: "disabled_manually" }],
      contents: {},
    });
    const { entries } = await predict(octokit, "o/r", 1);
    expect(entries).toEqual([
      {
        workflow: WF,
        job: "*",
        checkName: null,
        status: "no-dispatch",
        reason: "workflow state: disabled_manually",
      },
    ]);
  });

  it("ignores anything the Actions API lists outside .github/workflows", async () => {
    const octokit = fakeOctokit({
      workflows: [{ path: "dynamic/pages/pages-build-deployment", state: "active" }],
    });
    expect(await predict(octokit, "o/r", 1)).toEqual({
      entries: [],
      checkNames: [],
      skip: null,
      sources: [HEAD_SOURCE],
    });
  });

  it.each([
    ["[skip ci]", "chore: docs [skip ci]"],
    ["[ci skip]", "chore: docs [ci skip]"],
    ["[no ci]", "chore: docs [NO CI]"],
    ["[skip actions]", "chore: docs [skip actions]"],
    ["[actions skip]", "chore: docs [actions skip]"],
  ])("suppresses everything on a %s head commit", async (_label, message) => {
    expect(await run("on: pull_request\njobs:\n  a: {}\n", { message })).toEqual({
      entries: [],
      checkNames: [],
      skip: "head commit message contains a skip instruction",
      // Even a suppressed prediction names the commit it read to decide that.
      sources: [HEAD_SOURCE],
    });
  });

  it("suppresses everything on a skip-checks trailer", async () => {
    const message = "feat: thing\n\nskip-checks: true\n";
    expect(await run("on: pull_request\njobs:\n  a: {}\n", { message })).toEqual({
      entries: [],
      checkNames: [],
      skip: "head commit message contains a skip instruction",
      // Even a suppressed prediction names the commit it read to decide that.
      sources: [HEAD_SOURCE],
    });
  });

  it("keeps a workflow with no jobs as a run with no entries", async () => {
    expect(await run("on: pull_request\n")).toEqual({
      entries: [],
      checkNames: [],
      skip: null,
      sources: [HEAD_SOURCE],
    });
  });

  it("carries the workflow reason onto jobs that have none of their own", async () => {
    expect(await only("on: pull_request\njobs:\n  a: {}\n")).toEqual({
      workflow: WF,
      job: "a",
      checkName: "a",
      status: "run",
      reason: "trigger matched",
    });
  });
});

// --------------------------------------------------------------- job expansion

describe("job expansion", () => {
  it("tolerates a job whose body is empty", async () => {
    expect(await only("on: pull_request\njobs:\n  a:\n")).toMatchObject({
      job: "a",
      status: "run",
    });
  });

  it("uses an explicit job name over the job id", async () => {
    const wf = "on: pull_request\njobs:\n  a:\n    name: Build\n";
    expect(await only(wf)).toMatchObject({ job: "Build" });
  });

  it("falls back to the job id when `name` is present but null", async () => {
    const wf = "on: pull_request\njobs:\n  a:\n    name:\n";
    expect(await only(wf)).toMatchObject({ job: "a" });
  });

  it("records a job-level `if` as the entry reason", async () => {
    const wf = "on: pull_request\njobs:\n  a:\n    if: false\n";
    expect(await only(wf)).toMatchObject({
      job: "a",
      status: "skipped",
      reason: "if: false",
    });
  });

  describe("needs", () => {
    it("skips a job that needs a skipped job", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    if: false\n  b:\n    needs: [a]\n";
      const { entries } = await run(wf);
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "skipped"],
        ["b", "skipped"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' which is skipped");
    });

    it("accepts a scalar `needs`", async () => {
      const wf = "on: pull_request\njobs:\n  a:\n    if: false\n  b:\n    needs: a\n";
      const { entries } = await run(wf);
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped" });
    });

    it("propagates an unknown upstream status", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    if: needs.x.outputs.y == 'z'\n  b:\n    needs: [a]\n";
      const { entries } = await run(wf);
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "unknown"],
        ["b", "unknown"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' whose status is unknown");
    });

    it("leaves an already-unknown job unknown rather than restating why", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    if: github.ref == 'x'\n  b:\n    if: github.ref == 'y'\n    needs: [a]\n";
      const { entries } = await run(wf);
      expect(entries[1]).toMatchObject({
        job: "b",
        status: "unknown",
        reason: "if: \"github.ref == 'y'\"",
      });
    });

    it("does not propagate upstream status through always()", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    if: false\n  b:\n    if: always()\n    needs: [a]\n";
      const { entries } = await run(wf);
      expect(entries[1]).toMatchObject({ job: "b", status: "run" });
    });

    it("leaves an already-skipped job alone rather than re-deriving it", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    if: false\n  b:\n    if: false\n    needs: [a]\n";
      const { entries } = await run(wf);
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped", reason: 'if: false' });
    });
  });

  describe("matrix", () => {
    it("names one entry per combination", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    strategy:\n      matrix:\n        os: [linux, mac]\n";
      const { entries } = await run(wf);
      expect(entries.map((e) => e.job)).toEqual(["a (linux)", "a (mac)"]);
    });

    it("substitutes matrix values into an explicit job name", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    name: build ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [linux, mac]\n";
      const { entries } = await run(wf);
      expect(entries.map((e) => e.job)).toEqual(["build linux", "build mac"]);
    });

    it("leaves an unset matrix key in place rather than guessing at it", async () => {
      // #9 stopped rendering an unevaluable expression as the empty string. It
      // survives into the name verbatim and nulls `checkName` instead: a wrong
      // name reads as a MISS against a check that really ran, whereas an absent
      // one is something verify.ts can report as unresolved and move on.
      const wf =
        "on: pull_request\njobs:\n  a:\n    name: build ${{ matrix.nope }}\n    strategy:\n      matrix:\n        os: [linux]\n";
      expect(await only(wf)).toMatchObject({
        job: "build ${{ matrix.nope }}",
        checkName: null,
      });
    });

    it("evaluates github.event_name, the one expression this can decide", async () => {
      // predict() only ever answers for a pull_request dispatch, so this
      // expression is knowable and the name stays resolved.
      const wf =
        "on: pull_request\njobs:\n  a:\n    name: on ${{ github.event_name }}\n";
      expect(await only(wf)).toMatchObject({
        job: "on pull_request",
        checkName: "on pull_request",
      });
    });

    it("renders a null matrix value as nothing and a list value as a joined run", async () => {
      // The parenthetical is built from the raw YAML value, whatever shape it
      // has. A null renders as the empty string rather than "null", and a list
      // flattens the same way an object does.
      const wf =
        "on: pull_request\njobs:\n  a:\n    strategy:\n      matrix:\n        v: [~, [1, 2]]\n";
      const { entries } = await run(wf);
      expect(entries.map((e) => e.job)).toEqual(["a ()", "a (1, 2)"]);
    });

    it("omits the parenthetical when a combination has no keys to show", async () => {
      // An empty `include:` entry with no axes to attach to becomes a
      // combination of its own with nothing in it. One check, bare job id.
      const wf =
        "on: pull_request\njobs:\n  a:\n    strategy:\n      matrix:\n        include:\n          - {}\n";
      expect(await only(wf)).toMatchObject({ job: "a", checkName: "a" });
    });

    it("cannot resolve a matrix expression on a job that has no matrix", async () => {
      // `${{ matrix.* }}` outside a matrix is nothing we can substitute, so the
      // name stays unresolved rather than collapsing to an empty parenthetical.
      const wf =
        "on: pull_request\njobs:\n  a:\n    name: build ${{ matrix.os }}\n";
      expect(await only(wf)).toMatchObject({
        job: "build ${{ matrix.os }}",
        checkName: null,
        status: "run",
      });
    });

    it("reports a dynamic matrix as unknown", async () => {
      const wf =
        "on: pull_request\njobs:\n  a:\n    strategy:\n      matrix: ${{ fromJSON(needs.x.outputs.m) }}\n";
      expect(await only(wf)).toMatchObject({
        job: "a",
        status: "unknown",
        reason: "dynamic matrix",
      });
    });
  });

  describe("reusable workflows", () => {
    const caller = (uses: string, extra = "") =>
      `on: pull_request\njobs:\n  call:\n${extra}    uses: ${uses}\n`;

    it("inlines the called workflow's jobs under a prefixed name", async () => {
      const { entries } = await run(caller("./.github/workflows/sub.yml"), {
        contents: {
          [WF]: caller("./.github/workflows/sub.yml"),
          [SUB]: "on:\n  workflow_call:\njobs:\n  inner:\n    name: Inner\n",
        },
      });
      expect(entries.map((e) => [e.job, e.status])).toEqual([["call / Inner", "run"]]);
    });

    it("prefixes with the caller job's own name when it has one", async () => {
      const body = caller("./.github/workflows/sub.yml", "    name: Called\n");
      const { entries } = await run(body, {
        contents: { [WF]: body, [SUB]: "on:\n  workflow_call:\njobs:\n  inner: {}\n" },
      });
      expect(entries.map((e) => e.job)).toEqual(["Called / inner"]);
    });

    it("follows a nested call and keeps prefixing", async () => {
      const body = caller("./.github/workflows/sub.yml");
      const { entries } = await run(body, {
        contents: {
          [WF]: body,
          [SUB]: "on:\n  workflow_call:\njobs:\n  mid:\n    uses: ./.github/workflows/sub2.yml\n",
          [SUB2]: "on:\n  workflow_call:\njobs:\n  deep: {}\n",
        },
      });
      expect(entries).toEqual([
        {
          workflow: WF,
          job: "call / mid / deep",
          checkName: "call / mid / deep",
          status: "run",
          reason: "trigger matched",
        },
      ]);
    });

    it("gives up past the four-level call chain GitHub allows", async () => {
      // Not a self-imposed budget: a fifth level fails the run outright, so
      // there is no check name to predict. Level five is the first `uses:` we
      // decline to follow, and the entry stops at the caller that made it.
      const body = caller("./.github/workflows/n1.yml");
      const link = (next: string) =>
        `on:\n  workflow_call:\njobs:\n  j:\n    uses: ./.github/workflows/${next}\n`;
      const { entries } = await run(body, {
        contents: {
          [WF]: body,
          ".github/workflows/n1.yml": link("n2.yml"),
          ".github/workflows/n2.yml": link("n3.yml"),
          ".github/workflows/n3.yml": link("n4.yml"),
          ".github/workflows/n4.yml": link("n5.yml"),
          ".github/workflows/n5.yml": "on:\n  workflow_call:\njobs:\n  leaf: {}\n",
        },
      });
      expect(entries).toEqual([
        {
          workflow: WF,
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
      const body = caller(
        "./.github/workflows/sub.yml",
        "    strategy:\n      matrix: ${{ fromJSON(needs.x.outputs.m) }}\n",
      );
      const entry = await only(body, {
        contents: { [WF]: body, [SUB]: "on:\n  workflow_call:\n" },
      });
      expect(entry).toMatchObject({
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix on reusable workflow call",
      });
    });

    it("reports a callee that does not parse as unknown", async () => {
      const body = caller("./.github/workflows/sub.yml");
      const entry = await only(body, {
        contents: { [WF]: body, [SUB]: "jobs:\n  a: [unclosed\n" },
      });
      expect(entry).toMatchObject({ job: "call", checkName: null, status: "unknown" });
      expect(entry.reason).toMatch(
        /^YAML parse error in \.\/\.github\/workflows\/sub\.yml: /,
      );
    });

    it("reports a callee that parses to nothing as unresolvable", async () => {
      // An empty file is not a fetch failure and not a parse error: it parses
      // cleanly to null. There is still no workflow to expand, so the call has
      // to land somewhere rather than fall through as a resolved zero-job set.
      const body = caller("./.github/workflows/sub.yml");
      expect(await only(body, { contents: { [WF]: body, [SUB]: "" } })).toMatchObject({
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "cannot resolve ./.github/workflows/sub.yml",
      });
    });

    it("nulls the name of a skipped job inside an unresolvable caller", async () => {
      // A skipped job's own name is always resolved — nothing about it is
      // evaluated. The prefix is what is missing here, and an unresolved prefix
      // has to poison the whole subtree, skipped entries included.
      const body = caller(
        "./.github/workflows/sub.yml",
        "    name: ${{ inputs.flavour }}\n",
      );
      const entry = await only(body, {
        contents: {
          [WF]: body,
          [SUB]: "on:\n  workflow_call:\njobs:\n  inner:\n    if: false\n",
        },
      });
      expect(entry).toMatchObject({
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
      // No `refs` entry, so `@v1` 404s the way a deleted tag does. Falling back
      // to reading the mutable ref is exactly what must not happen: the answer
      // would be unnameable afterwards.
      const uses = "octo/repo/.github/workflows/x.yml@v1";
      expect(await only(caller(uses))).toMatchObject({
        job: "call",
        status: "unknown",
        reason: `cannot resolve ref for ${uses}`,
      });
    });

    it("reports a cross-repo reusable it resolved but cannot fetch", async () => {
      const uses = "octo/repo/.github/workflows/x.yml@v1";
      const body = caller(uses);
      expect(
        await only(body, {
          contents: { [WF]: body },
          refs: { "octo/repo@v1": REMOTE_SHA },
        }),
      ).toMatchObject({
        job: "call",
        status: "unknown",
        reason: `cannot fetch ${uses}`,
      });
    });

    it("skips resolution for a `uses:` already pinned to a commit", async () => {
      // Nothing to look up: the ref is the commit. Asking anyway would spend a
      // request per call site on an answer already written down.
      const uses = `octo/repo/.github/workflows/x.yml@${REMOTE_SHA}`;
      const body = caller(uses);
      expect(
        await only(body, { contents: { [WF]: body } }),
      ).toMatchObject({
        job: "call",
        status: "unknown",
        // `cannot fetch`, not `cannot resolve`: resolution never ran, and this
        // fixture lists no ref that would have let it succeed if it had.
        reason: `cannot fetch ${uses}`,
      });
    });

    it("reports a local reusable that is missing at head", async () => {
      expect(await only(caller("./.github/workflows/sub.yml"))).toMatchObject({
        job: "call",
        status: "unknown",
        reason: "cannot fetch ./.github/workflows/sub.yml",
      });
    });

    it("skips a caller job whose `if` is false without expanding it", async () => {
      const body = caller("./.github/workflows/sub.yml", "    if: false\n");
      expect(
        await only(body, {
          contents: { [WF]: body, [SUB]: "on:\n  workflow_call:\njobs:\n  inner: {}\n" },
        }),
      ).toMatchObject({ job: "call", status: "skipped", reason: 'if: false' });
    });
  });
});

// A prediction is only reconcilable against a run if it can say which commits it
// was computed from. `v0` is a tag someone moves; two reads an hour apart can be
// two different programs. So every ref gets resolved before anything is read at
// it, and the commit goes in the answer.
describe("the commits a prediction was read from", () => {
  const caller = (uses: string) => `on: pull_request\njobs:\n  call:\n    uses: ${uses}\n`;

  const CALLEE = "on:\n  workflow_call:\njobs:\n  inner:\n    runs-on: ubuntu-latest\n";

  it("names only the head when nothing else is read", async () => {
    const { sources } = await run("on: pull_request\njobs:\n  a: {}\n");
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("does not name a second source for a local `./` call", async () => {
    // A local callee is the same commit as the caller, already named.
    const body = caller("./.github/workflows/sub.yml");
    const { sources } = await run(body, { contents: { [WF]: body, [SUB]: CALLEE } });
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("names a cross-repo callee by the commit its ref resolved to", async () => {
    const body = caller("octo/repo/.github/workflows/x.yml@v1");
    const { sources } = await run(body, {
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    expect(sources).toEqual([
      HEAD_SOURCE,
      // The ref as written is kept alongside the commit: dropping it would lose
      // what the workflow actually asked for.
      { owner: "octo", repo: "repo", ref: "v1", sha: REMOTE_SHA },
    ]);
  });

  it("does not name a source whose ref would not resolve", async () => {
    // The entry behind it is unknown, which turns the gate red. Naming a source
    // here would claim a commit was read when none was.
    const body = caller("octo/repo/.github/workflows/x.yml@v1");
    const { sources } = await run(body, { contents: { [WF]: body } });
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("reads a callee at the resolved commit, never at the ref that named it", async () => {
    // The whole point of resolving. Fetching at `v1` would leave a prediction
    // naming a commit it did not actually read.
    const body = caller("octo/repo/.github/workflows/x.yml@v1");
    const octokit = fakeOctokit({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getContent = vi.spyOn(octokit.rest.repos, "getContent");
    await predict(octokit, "o/r", 1);
    expect(getContent).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "octo", repo: "repo", ref: REMOTE_SHA }),
    );
  });

  it("resolves a ref once however many jobs name it", async () => {
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: octo/repo/.github/workflows/x.yml@v1\n" +
      "  b:\n    uses: octo/repo/.github/workflows/x.yml@v1\n";
    const octokit = fakeOctokit({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getCommit = vi.spyOn(octokit.rest.repos, "getCommit");
    const { sources } = await predict(octokit, "o/r", 1);
    // One for the head commit's message, one for `v1`. The second `v1` is the
    // cache, not a request.
    expect(getCommit).toHaveBeenCalledTimes(2);
    expect(sources).toHaveLength(2);
  });

  it("remembers a ref that would not resolve rather than asking again", async () => {
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: octo/repo/.github/workflows/x.yml@v1\n" +
      "  b:\n    uses: octo/repo/.github/workflows/x.yml@v1\n";
    const octokit = fakeOctokit({ contents: { [WF]: body } });
    const getCommit = vi.spyOn(octokit.rest.repos, "getCommit");
    const { entries } = await predict(octokit, "o/r", 1);
    expect(getCommit).toHaveBeenCalledTimes(2);
    expect(entries.map((e) => e.status)).toEqual(["unknown", "unknown"]);
  });

  it("reads a callee once when two refs name the same commit", async () => {
    // `@v1` and the commit it points at are one file. Keying the read on the
    // ref would fetch it twice and, worse, allow two different answers.
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: octo/repo/.github/workflows/x.yml@v1\n" +
      `  b:\n    uses: octo/repo/.github/workflows/x.yml@${REMOTE_SHA}\n`;
    const octokit = fakeOctokit({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getContent = vi.spyOn(octokit.rest.repos, "getContent");
    await predict(octokit, "o/r", 1);
    // The caller's own workflow, then the callee once for both jobs.
    expect(getContent).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------------- pure helpers

describe("expandMatrix", () => {
  it("returns a single null combination when there is no strategy", () => {
    expect(expandMatrix(undefined)).toEqual([null]);
    expect(expandMatrix({})).toEqual([null]);
  });

  it("gives up on a matrix that is an expression", () => {
    expect(expandMatrix({ matrix: "${{ fromJSON(x) }}" })).toBeNull();
  });

  it("gives up on an expression under include or exclude", () => {
    expect(expandMatrix({ matrix: { include: "${{ x }}" } })).toBeNull();
    expect(expandMatrix({ matrix: { exclude: "${{ x }}" } })).toBeNull();
  });

  it("gives up on an axis that is not a list", () => {
    expect(expandMatrix({ matrix: { os: "${{ x }}" } })).toBeNull();
    expect(expandMatrix({ matrix: { os: 3 } })).toBeNull();
  });

  it("expands an axis written as an expression over known outputs", () => {
    // The fleet shape: the axis is the values another job computed, and they
    // are knowable exactly when the scope carries that job's outputs.
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    const scope = { needs: { d: { outputs: { langs: '["typescript","rust"]' } } } };
    expect(expandMatrix(strategy, scope)).toEqual([
      { language: "typescript" },
      { language: "rust" },
    ]);
  });

  it("expands such an axis to nothing when the output is an empty array", () => {
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    expect(expandMatrix(strategy, { needs: { d: { outputs: { langs: "[]" } } } })).toEqual([]);
  });

  it("multiplies a dynamic axis against a static one", () => {
    const strategy = {
      matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}", os: ["linux"] },
    };
    const scope = { needs: { d: { outputs: { langs: '["ts"]' } } } };
    expect(expandMatrix(strategy, scope)).toEqual([{ language: "ts", os: "linux" }]);
  });

  it("gives up on an axis expression the scope cannot settle", () => {
    const strategy = { matrix: { language: "${{ fromJSON(needs.d.outputs.langs) }}" } };
    expect(expandMatrix(strategy)).toBeNull();
    expect(expandMatrix(strategy, { needs: { other: { outputs: {} } } })).toBeNull();
  });

  it("gives up on an axis expression that is not an array", () => {
    // A scalar cannot be an axis, and neither can an object. Treating either
    // as one combination would invent a check name.
    const scope = { needs: { d: { outputs: { s: '"ts"', o: "{}" } } } };
    expect(expandMatrix({ matrix: { l: "${{ fromJSON(needs.d.outputs.s) }}" } }, scope)).toBeNull();
    expect(expandMatrix({ matrix: { l: "${{ fromJSON(needs.d.outputs.o) }}" } }, scope)).toBeNull();
  });

  it("takes the cartesian product of the axes", () => {
    expect(expandMatrix({ matrix: { os: ["linux", "mac"], node: [20, 22] } })).toEqual([
      { os: "linux", node: 20 },
      { os: "linux", node: 22 },
      { os: "mac", node: 20 },
      { os: "mac", node: 22 },
    ]);
  });

  it("drops excluded combinations", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux", "mac"], exclude: [{ os: "mac" }] } }),
    ).toEqual([{ os: "linux" }]);
  });

  it("returns no combinations when everything is excluded", () => {
    expect(expandMatrix({ matrix: { os: ["linux"], exclude: [{ os: "linux" }] } })).toEqual([]);
  });

  it("returns no combinations for an empty axis", () => {
    expect(expandMatrix({ matrix: { language: [] } })).toEqual([]);
  });

  it("returns no combinations when any axis is empty", () => {
    // The product with an empty axis is empty, however many values the other
    // axes carry.
    expect(expandMatrix({ matrix: { a: [], b: ["x"] } })).toEqual([]);
    expect(expandMatrix({ matrix: { a: ["x"], b: [] } })).toEqual([]);
    expect(expandMatrix({ matrix: { a: [], b: [] } })).toEqual([]);
  });

  it("returns no combinations for a matrix with no keys", () => {
    // Distinct from an absent `matrix:`, which is the single-unsuffixed-job
    // case above.
    expect(expandMatrix({ matrix: {} })).toEqual([]);
  });

  it("merges an include that overlaps an existing combination", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux", "mac"], include: [{ os: "mac", flag: "x" }] } }),
    ).toEqual([{ os: "linux" }, { os: "mac", flag: "x" }]);
  });

  it("appends an include that overlaps no existing combination", () => {
    expect(
      expandMatrix({ matrix: { os: ["linux"], include: [{ os: "mac", flag: "x" }] } }),
    ).toEqual([{ os: "linux" }, { os: "mac", flag: "x" }]);
  });

  it("appends an include that shares no axis at all", () => {
    expect(expandMatrix({ matrix: { include: [{ flag: "x" }] } })).toEqual([{ flag: "x" }]);
  });
});

// The check-name readout for the case above: an empty matrix has to produce no
// entries, not one. `[null]` inside the expander means "a job with no matrix",
// whose check is the bare job name — and that is a name GitHub never creates
// for a job that declares a matrix, so predicting it invents a check.
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

describe("evalIf", () => {
  it.each([
    [undefined, "run"],
    [null, "run"],
    ["true", "run"],
    ["True", "run"],
    ["always()", "run"],
    ["${{ always() }}", "run"],
    ["false", "skipped"],
    ["False", "skipped"],
    ["${{ false }}", "skipped"],
    ["github.event_name == 'pull_request'", "run"],
    ["github.event_name != 'pull_request'", "skipped"],
    ["github.event_name == 'push'", "skipped"],
    ["github.event_name != 'push'", "run"],
    ["github.ref == 'refs/heads/main'", "unknown"],
  ] as const)("reads %s as %s", (cond, expected) => {
    expect(evalIf(cond)).toBe(expected);
  });
});

// ------------------------------------------------------------------- octokit

// The commit-count heuristic is wrong in both directions and cannot produce
// `reopened` at all. It only matters to a workflow that narrows `types:`, and
// there it decides whether the workflow dispatches — so a caller that knows
// the real action has to be able to say so.
describe("a caller-supplied event action", () => {
  const runWith = (body: string, f: Fixture, opts: Parameters<typeof predict>[3]) =>
    predict(fakeOctokit({ contents: { [WF]: body }, ...f }), "o/r", 1, opts);

  const onTypes = (types: string) =>
    `on:\n  pull_request:\n    types: [${types}]\njobs:\n  a: {}\n`;

  it("beats the heuristic when the PR has several commits but was just opened", async () => {
    // Three commits infers `synchronize`, which `types: [opened]` refuses.
    const { entries } = await runWith(onTypes("opened"), { commits: 3 }, { action: "opened" });
    expect(entries).toMatchObject([{ job: "a", status: "run" }]);
  });

  it("beats the heuristic when a force-push left one commit", async () => {
    // One commit infers `opened`, which `types: [synchronize]` refuses.
    const { entries } = await runWith(
      onTypes("synchronize"),
      { commits: 1 },
      { action: "synchronize" },
    );
    expect(entries).toMatchObject([{ job: "a", status: "run" }]);
  });

  it("can say `reopened`, which the heuristic never produces", async () => {
    const { entries } = await runWith(onTypes("reopened"), {}, { action: "reopened" });
    expect(entries).toMatchObject([{ job: "a", status: "run" }]);
  });

  it("still refuses an action the workflow does not declare", async () => {
    // Passing the action explicitly is not permission to dispatch — it is the
    // input the existing `types:` test runs against.
    const { entries } = await runWith(onTypes("opened"), {}, { action: "reopened" });
    expect(entries).toMatchObject([
      { status: "no-dispatch", reason: "action 'reopened' not in types [opened]" },
    ]);
  });

  it("falls back to the heuristic when omitted", async () => {
    expect(await only(onTypes("opened"), { commits: 3 })).toMatchObject({
      reason: "action 'synchronize' not in types [opened]",
    });
    expect(await only(onTypes("opened"), { commits: 1 })).toMatchObject({ status: "run" });
  });

  it("falls back to the heuristic when the option is present but undefined", async () => {
    const { entries } = await runWith(onTypes("opened"), { commits: 3 }, { action: undefined });
    expect(entries).toMatchObject([
      { status: "no-dispatch", reason: "action 'synchronize' not in types [opened]" },
    ]);
  });
});

describe("makeOctokit", () => {
  beforeEach(() => {
    hoisted.authSeen.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to build a client with no token in the environment", () => {
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", undefined);
    expect(() => makeOctokit()).toThrow("GH_TOKEN or GITHUB_TOKEN must be set");
  });

  it("prefers GH_TOKEN", () => {
    vi.stubEnv("GH_TOKEN", "gh");
    vi.stubEnv("GITHUB_TOKEN", "gha");
    makeOctokit();
    expect(hoisted.authSeen).toEqual(["gh"]);
  });

  it("falls back to GITHUB_TOKEN", () => {
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", "gha");
    makeOctokit();
    expect(hoisted.authSeen).toEqual(["gha"]);
  });
});

// ----------------------------------------------------------------------- CLI

describe("the CLI entrypoint", () => {
  const argv = process.argv;
  let out: string[];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("GH_TOKEN", "gh");
  });

  afterEach(() => {
    process.argv = argv;
    hoisted.octokit = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Re-import the module as if node had been pointed at it directly. */
  async function invoke(args: string[], f: Fixture = {}): Promise<void> {
    hoisted.octokit = fakeOctokit(f);
    process.argv = ["node", "/somewhere/predict.ts", ...args];
    vi.resetModules();
    await import("./predict.js");
  }

  const WORKFLOW = "on: pull_request\njobs:\n  a: {}\n";

  /** Provenance trails every plain-text run: one line, the head commit. */
  const HEAD_READ = `# read o/r@${HEAD_SHA} -> ${HEAD_SHA}`;

  it("stays quiet when the module is imported rather than run", async () => {
    process.argv = ["node"];
    vi.resetModules();
    await import("./predict.js");
    expect(out).toEqual([]);
  });

  it("prints one line per entry", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: { [WF]: WORKFLOW } });
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });

  it("comments out a workflow-level verdict", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: {} });
    expect(out).toEqual([`# ${WF} :: no-dispatch (no workflow file at head)`, HEAD_READ]);
  });

  it("reports a suppressing skip instruction on its own", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: WORKFLOW },
      message: "chore: docs [skip ci]",
    });
    expect(out).toEqual([
      "# head commit message contains a skip instruction -> nothing dispatches",
      HEAD_READ,
    ]);
  });

  it("says so in the line rather than printing a name it could not resolve", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: "on: pull_request\njobs:\n  a:\n    name: on ${{ inputs.x }}\n" },
    });
    expect(out).toEqual([`${WF} :: on \${{ inputs.x }} (name unresolved) :: run`, HEAD_READ]);
  });

  it("emits JSON under --json", async () => {
    await invoke(["--repo", "o/r", "--pr", "1", "--json"], { contents: { [WF]: WORKFLOW } });
    expect(JSON.parse(out.join("\n"))).toEqual({
      skip: null,
      checkNames: ["a"],
      entries: [
        { workflow: WF, job: "a", checkName: "a", status: "run", reason: "trigger matched" },
      ],
      sources: [HEAD_SOURCE],
    });
  });

  it("passes --action through instead of inferring one", async () => {
    // `types: [synchronize]` with a single commit: the heuristic says `opened`
    // and the workflow would not dispatch.
    await invoke(["--repo", "o/r", "--pr", "1", "--action", "synchronize"], {
      contents: { [WF]: "on:\n  pull_request:\n    types: [synchronize]\njobs:\n  a: {}\n" },
    });
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });

  it("exits 2 on an --action it does not recognise", async () => {
    // Refused, not ignored: falling back to the guess would turn a typo into a
    // wrong prediction, which is the failure the flag exists to remove.
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(
      invoke(["--repo", "o/r", "--pr", "1", "--action", "syncronize"]),
    ).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("unknown --action: syncronize");
    expect(vi.mocked(console.error).mock.calls[1][0]).toMatch(/^usage: predict /);
  });

  it("names --action in the usage line", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(invoke(["--pr", "1"])).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(
      "--action opened|synchronize|reopened",
    );
  });

  it("exits 2 with a usage line when --repo or --pr is missing", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(invoke(["--pr", "1"])).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/^usage: predict /);
  });

  it("passes --execute grants through to prediction", async () => {
    // The grant names a repo no workflow here comes from, so nothing executes
    // and nothing downloads — but the flag parses and the prediction runs.
    await invoke(["--repo", "o/r", "--pr", "1", "--execute", "x/y:detect"], {
      contents: { [WF]: WORKFLOW },
    });
    expect(out).toEqual([`${WF} :: a :: run`, HEAD_READ]);
  });

  it("exits 2 on an --execute it cannot parse", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(
      invoke(["--repo", "o/r", "--pr", "1", "--execute", "nope"]),
    ).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("bad --execute: nope");
    expect(vi.mocked(console.error).mock.calls[1][0]).toMatch(/--execute owner\/repo:job1,job2/);
  });

  it("exits 2 on a trailing --execute with no grant", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(
      invoke(["--repo", "o/r", "--pr", "1", "--execute"]),
    ).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("bad --execute: undefined");
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

// Cross-repo `uses:` (#13). The resolvable path — which ref GitHub actually
// reads, and how a `./` inside a remote callee resolves — is pinned against live
// dispatches in tests/integration/names.test.ts. What is left for the unit tier
// is the address parser and the two failure shapes around it.
describe("cross-repo reusable references", () => {
  it("parses both spellings and takes the ref from the last @", () => {
    expect(parseUses("./.github/workflows/x.yml")).toEqual({
      path: ".github/workflows/x.yml",
      source: null,
    });
    expect(parseUses("o/r/.github/workflows/x.yml@v1")).toEqual({
      path: ".github/workflows/x.yml",
      source: { owner: "o", repo: "r", ref: "v1" },
    });
    // A branch name may contain a slash, so the ref is everything after the
    // last `@` rather than the next path segment.
    expect(parseUses("o/r/w.yml@feature/foo")).toEqual({
      path: "w.yml",
      source: { owner: "o", repo: "r", ref: "feature/foo" },
    });
  });

  it.each([
    ["${{ env.CALLEE }}/.github/workflows/x.yml@v1", "built from an expression"],
    ["./", "a local path with nothing after it"],
    ["not-a-reference", "no @ at all"],
    ["owner/repo@v1", "no path between the repo and the ref"],
    ["owner/repo/x.yml@", "an empty ref"],
    ["@v1", "an empty address"],
  ])("rejects %j — %s", (uses) => {
    expect(parseUses(uses)).toBeNull();
  });

  it("reports a uses: it cannot turn into a fetch target", async () => {
    const body = "on: pull_request\njobs:\n  call:\n    uses: not-a-reference\n";
    const { entries } = await predict(
      fakeOctokit({ contents: { [WF]: body } }),
      "o/r",
      1,
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        job: "call",
        status: "unknown",
        reason: "unresolvable reusable reference: not-a-reference",
      }),
    );
  });

  it("fetches a callee named twice only once", async () => {
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: ./.github/workflows/sub.yml\n" +
      "  b:\n    uses: ./.github/workflows/sub.yml\n";
    const octokit = fakeOctokit({
      contents: {
        [WF]: body,
        [SUB]: "on:\n  workflow_call:\njobs:\n  inner:\n    name: Inner\n",
      },
    });
    const spy = vi.spyOn(octokit.rest.repos, "getContent");
    const { entries } = await predict(octokit, "o/r", 1);
    expect(entries.map((e) => e.job)).toEqual(["a / Inner", "b / Inner"]);
    const subFetches = spy.mock.calls.filter((c) => c[0]?.path === SUB);
    expect(subFetches).toHaveLength(1);
  });
});

// The executor seam: expansion asks it, before anything reads `needs`,
// whether the caller granted a job — and folds what an execution yields into
// the scope every later evaluation sees. The executor itself is faked here;
// what it actually does when it runs things is execute.test.ts's subject.
describe("github.repository as a prediction-wide fact", () => {
  it("decides a repository guard from the repo the PR is against", async () => {
    const wf = JSON.stringify({
      on: "pull_request",
      jobs: {
        published: { if: "github.repository != 'o/r'" },
        hermetic: { if: "github.repository == 'o/r'" },
      },
    });
    const { checkNames } = await predict(fakeOctokit({ contents: { [WF]: wf } }), "o/r", 1);
    expect(checkNames).toEqual(["hermetic"]);
  });

  it("carries the fact across a reusable workflow call", async () => {
    const sub = JSON.stringify({
      on: { workflow_call: null },
      jobs: { inner: { if: "github.repository == 'o/r'" } },
    });
    const wf = JSON.stringify({
      on: "pull_request",
      jobs: { call: { uses: "./.github/workflows/sub.yml" } },
    });
    const octokit = fakeOctokit({
      contents: { [WF]: wf, ".github/workflows/sub.yml": sub },
    });
    const { checkNames } = await predict(octokit, "o/r", 1);
    expect(checkNames).toEqual(["call / inner"]);
  });
});

describe("granted execution during expansion", () => {
  const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: "main", sha: SHA };
  const CTX = { action: "opened", baseRef: "main", files: ["src/app.ts"] };
  const reader = readerOf(async () => null);

  /** A detect-shaped workflow: one producer, one dynamic-matrix consumer. */
  const wfWith = (detect: Record<string, unknown>) => ({
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

  const executorReturning = (outcome: ExecOutcome, log: string[] = []) => ({
    granted: (src: WorkflowSource, jobId: string) =>
      `${src.owner}/${src.repo}` === "o/r" && jobId === "detect",
    executeJob: async (jobId: string) => {
      log.push(jobId);
      return outcome;
    },
  });

  it("resolves a dynamic matrix from what the granted job produced", async () => {
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

  it("normalizes a null granted job body before executing it", async () => {
    const wf = {
      on: { pull_request: null },
      jobs: {
        detect: null,
        cover: {
          needs: "detect",
          name: "Coverage (${{ matrix.language }})",
          strategy: { matrix: { language: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
        },
      },
    };
    const entries = await expandWorkflowJobs(
      wf,
      CTX,
      reader,
      SOURCE,
      {},
      executorReturning({ ok: true, outputs: { langs: '["ts"]' } }),
    );
    expect(entries[1]).toMatchObject({ checkName: "Coverage (ts)", status: "run" });
  });

  it("leaves an ungranted job exactly as unresolved as before", async () => {
    const log: string[] = [];
    const executor = {
      ...executorReturning({ ok: true, outputs: { langs: "[]" } }, log),
      granted: () => false,
    };
    const entries = await expandWorkflowJobs(wfWith({}), CTX, reader, SOURCE, {}, executor);
    expect(log).toEqual([]);
    expect(entries[1]).toMatchObject({ status: "unknown", reason: "dynamic matrix" });
  });

  it("does not execute a granted job that would not run", async () => {
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

  it("executes a granted job whose guard the caller's scope decides", async () => {
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

  it("reaches a granted job inside a called workflow", async () => {
    // The grant names the repo the workflow *file* lives in; a local call
    // keeps the caller's source, so the recursion is where it fires.
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

// The wiring above the seam: `predict` builds a real executor only when the
// caller granted something, and its tree downloads go to the tarball
// endpoint. Failures surface as reasons, never as different answers — the
// happy path through real subprocesses is execute.test.ts's subject.
describe("execution grants through predict", () => {
  const DYNAMIC = JSON.stringify({
    on: "pull_request",
    jobs: {
      detect: { steps: [] },
      cover: {
        needs: "detect",
        name: "Coverage (${{ matrix.language }})",
        strategy: { matrix: { language: "${{ fromJSON(needs.detect.outputs.langs) }}" } },
      },
    },
  });
  const GRANT = { execute: [{ repo: "o/r", jobs: ["detect"] }] };

  const coverEntry = async (f: Fixture, opts: Parameters<typeof predict>[3]) => {
    const { entries } = await predict(
      fakeOctokit({ contents: { [WF]: DYNAMIC }, ...f }),
      "o/r",
      1,
      opts,
    );
    expect(entries).toHaveLength(2);
    return entries[1];
  };

  it("says which execution failed when the tarball is not served", async () => {
    const e = await coverEntry({}, GRANT);
    expect(e).toMatchObject({
      status: "unknown",
      checkName: null,
      reason: `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${HEAD_SHA}`,
    });
  });

  it("says the same when the download yields something tar refuses", async () => {
    const e = await coverEntry(
      { tarballs: { [`o/r@${HEAD_SHA}`]: new Uint8Array([1, 2, 3]) } },
      GRANT,
    );
    expect(e).toMatchObject({
      status: "unknown",
      reason: `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${HEAD_SHA}`,
    });
  });

  it("builds no executor for an empty grant list", async () => {
    const e = await coverEntry({}, { execute: [] });
    expect(e).toMatchObject({ status: "unknown", reason: "dynamic matrix" });
  });
});
