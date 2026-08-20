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
// thekevinbot/willrun-probe, and the probe workflows under `probe/` are the
// record. Changing one of these assertions means claiming GitHub changed.

import type { Octokit } from "@octokit/rest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evalIf,
  expandMatrix,
  makeOctokit,
  matchFilters,
  patternToRegex,
  predict,
  type Entry,
  type Prediction,
} from "./predict.js";

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
}

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
            head: { sha: "deadbeef" },
          },
        }),
        listFiles: LIST_FILES,
      },
      repos: {
        getCommit: async () => ({
          data: { commit: { message: f.message ?? "chore: routine" } },
        }),
        getContent: async ({ path }: { path: string }) => {
          if (!(path in contents)) throw new Error(`404 ${path}`);
          return { data: contents[path] };
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
    expect(await predict(octokit, "o/r", 1)).toEqual({ entries: [], checkNames: [], skip: null });
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
    });
  });

  it("suppresses everything on a skip-checks trailer", async () => {
    const message = "feat: thing\n\nskip-checks: true\n";
    expect(await run("on: pull_request\njobs:\n  a: {}\n", { message })).toEqual({
      entries: [],
      checkNames: [],
      skip: "head commit message contains a skip instruction",
    });
  });

  it("keeps a workflow with no jobs as a run with no entries", async () => {
    expect(await run("on: pull_request\n")).toEqual({ entries: [], checkNames: [], skip: null });
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

    it("cannot see inside a workflow from another repo", async () => {
      const uses = "octo/repo/.github/workflows/x.yml@v1";
      expect(await only(caller(uses))).toMatchObject({
        job: "call",
        status: "unknown",
        reason: `non-local reusable: ${uses}`,
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

  it("returns a single null combination when everything is excluded", () => {
    expect(expandMatrix({ matrix: { os: ["linux"], exclude: [{ os: "linux" }] } })).toEqual([
      null,
    ]);
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

  it("stays quiet when the module is imported rather than run", async () => {
    process.argv = ["node"];
    vi.resetModules();
    await import("./predict.js");
    expect(out).toEqual([]);
  });

  it("prints one line per entry", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: { [WF]: WORKFLOW } });
    expect(out).toEqual([`${WF} :: a :: run`]);
  });

  it("comments out a workflow-level verdict", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], { contents: {} });
    expect(out).toEqual([`# ${WF} :: no-dispatch (no workflow file at head)`]);
  });

  it("reports a suppressing skip instruction on its own", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: WORKFLOW },
      message: "chore: docs [skip ci]",
    });
    expect(out).toEqual([
      "# head commit message contains a skip instruction -> nothing dispatches",
    ]);
  });

  it("says so in the line rather than printing a name it could not resolve", async () => {
    await invoke(["--repo", "o/r", "--pr", "1"], {
      contents: { [WF]: "on: pull_request\njobs:\n  a:\n    name: on ${{ inputs.x }}\n" },
    });
    expect(out).toEqual([`${WF} :: on \${{ inputs.x }} (name unresolved) :: run`]);
  });

  it("emits JSON under --json", async () => {
    await invoke(["--repo", "o/r", "--pr", "1", "--json"], { contents: { [WF]: WORKFLOW } });
    expect(JSON.parse(out.join("\n"))).toEqual({
      skip: null,
      checkNames: ["a"],
      entries: [
        { workflow: WF, job: "a", checkName: "a", status: "run", reason: "trigger matched" },
      ],
    });
  });

  it("exits 2 with a usage line when --repo or --pr is missing", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
    await expect(invoke(["--pr", "1"])).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/^usage: predict /);
  });
});
