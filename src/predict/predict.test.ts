// End-to-end suite for `predict()`, driven against a hand-built GitHub client
// stand-in.
//
// The expectations are not opinions about how GitHub *ought* to behave. The
// workflow-level verdicts were settled in #7 against live dispatches on
// thekevinbot/willrun-probe, and the probe workflows under
// `tests/fixtures/willrun-probe/` are the record. Changing one of these
// assertions means claiming GitHub changed.

import type { GithubClient } from "./makeGithubClient.js";
import { describe, expect, it, vi } from "vitest";
import { resolveCallbackMap } from "../callback/resolveCallbackMap.js";
import { expandJobs } from "../jobs/expandJobs.js";
import { predict } from "./predict.js";
import type { Entry, Prediction } from "../types.js";

// A spy over the real expansion: the definition site each workflow is expanded
// under is part of what this suite pins, and nothing downstream echoes it back.
vi.mock("../jobs/expandJobs.js", async () => {
  const actual =
    await vi.importActual<typeof import("../jobs/expandJobs.js")>("../jobs/expandJobs.js");
  return { ...actual, expandJobs: vi.fn(actual.expandJobs) };
});

// A spy over the real resolution, so callback tests can answer a map or fail
// without spawning anything. The real thing resolves `[]` to no map at all.
vi.mock("../callback/resolveCallbackMap.js", async () => {
  const actual = await vi.importActual<typeof import("../callback/resolveCallbackMap.js")>(
    "../callback/resolveCallbackMap.js",
  );
  return { ...actual, resolveCallbackMap: vi.fn(actual.resolveCallbackMap) };
});

// ------------------------------------------------------------------ fixtures

const WF = ".github/workflows/w.yml";
const SUB = ".github/workflows/sub.yml";

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
  /** Contents at `mergeSha`, served instead of `contents`. Missing key: 404. */
  mergeContents?: Record<string, string>;
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
  /** The PR's `merge_commit_sha` — its test merge. Absent means null. */
  mergeSha?: string | null;
  /** Parent shas by commit sha, via `getCommit`. Unlisted: no parents. */
  parents?: Record<string, string[]>;
  /** Open PRs, for the stack walk's `listPulls` lookup by head branch. */
  openPrs?: { headRef: string; baseRef: string; mergeSha: string | null }[];
}

/** The head commit of the PR every fixture describes. */
const HEAD_SHA = "deadbeef";

/** The one source every prediction reads, whatever else it reaches. */
const HEAD_SOURCE = { owner: "o", repo: "r", ref: HEAD_SHA, sha: HEAD_SHA };

/** The test merge commit. Sorts after the head, the order `sources` is in. */
const MERGE_SHA = "f".repeat(40);
const MERGE_SOURCE = { owner: "o", repo: "r", ref: MERGE_SHA, sha: MERGE_SHA };

/**
 * A commit in some other repo, spelled the full 40 hex digits.
 *
 * The length is the point: whether a ref needs resolving is decided by its
 * shape, so a short stand-in would take the other branch.
 */
const REMOTE_SHA = "b".repeat(40);

function fakeGithub(f: Fixture): GithubClient {
  const contents = f.contents ?? {};
  const api = {
    getPull: async () => ({
      commits: f.commits ?? 1,
      base: { ref: f.baseRef ?? "main" },
      head: { sha: HEAD_SHA },
      merge_commit_sha: f.mergeSha ?? null,
    }),
    listPulls: async ({ head }: { head: string }) =>
      (f.openPrs ?? [])
        .filter((p) => `o:${p.headRef}` === head)
        .map((p) => ({ base: { ref: p.baseRef }, merge_commit_sha: p.mergeSha })),
    listPullFiles: async () => (f.files ?? ["src/app.ts"]).map((filename) => ({ filename })),
    getCommit: async ({ owner, repo, ref }: { owner: string; repo: string; ref: string }) => {
      // Two callers share this route: the head-commit read that looks for a
      // skip instruction, and ref resolution. Only the first has a message.
      if (ref === HEAD_SHA) {
        return { sha: ref, commit: { message: f.message ?? "chore: routine" } };
      }
      const sha = (f.refs ?? {})[`${owner}/${repo}@${ref}`];
      if (sha === undefined) {
        throw new Error(`404 ${owner}/${repo}@${ref}`);
      }
      const parents = ((f.parents ?? {})[sha] ?? []).map((p) => ({ sha: p }));
      return { sha, commit: { message: "" }, parents };
    },
    getContent: async ({ path, ref }: { path: string; ref: string }) => {
      const at = f.mergeContents !== undefined && ref === f.mergeSha ? f.mergeContents : contents;
      if (!(path in at)) {
        throw new Error(`404 ${path}`);
      }
      return at[path];
    },
    downloadTarball: async ({ owner, repo, ref }: Record<string, string>) => {
      const bytes = (f.tarballs ?? {})[`${owner}/${repo}@${ref}`];
      if (bytes === undefined) {
        throw new Error(`404 tarball ${owner}/${repo}@${ref}`);
      }
      return bytes.buffer;
    },
    listWorkflows: async () => f.workflows ?? [{ path: WF, state: "active" }],
  };
  return api as unknown as GithubClient;
}

/** Predict against a repo whose only workflow is `body` at `.github/workflows/w.yml`. */
function run(body: string, f: Fixture = {}): Promise<Prediction> {
  return predict(fakeGithub({ contents: { [WF]: body }, ...f }), "o/r", 1);
}

/** The single entry `run()` produced, asserting there is exactly one. */
async function only(body: string, f: Fixture = {}): Promise<Entry> {
  const { entries } = await run(body, f);
  expect(entries).toHaveLength(1);
  return entries[0];
}

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
      fakeGithub({ contents: {} }),
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

  // ---- stacked PRs (#30) ----

  // GitHub's stack-aware dispatch (a per-repo rollout, read off dirsql#1002)
  // evaluates `branches:` against the stack's terminal target; the mode shows
  // in `merge_commit_sha`'s first parent.

  /** A child PR based on `feature-1`, whose parent PR targets `main`. */
  const STACKED: Fixture = {
    baseRef: "feature-1",
    mergeSha: "m-child",
    refs: {
      "o/r@m-child": "m-child",
      "o/r@feature-1": "tip-1", // the base tip is NOT what the preview sits on
      "o/r@m-parent": "m-parent",
      "o/r@main": "tip-main",
    },
    parents: {
      "m-child": ["m-parent"], // built on the parent PR's test merge: stacked
      "m-parent": ["tip-main"], // parent built on the main tip: walk ends here
    },
    openPrs: [{ headRef: "feature-1", baseRef: "main", mergeSha: "m-parent" }],
  };

  it("dispatches a `branches` workflow against the stack's target (#30)", async () => {
    const wf = "on:\n  pull_request:\n    branches: [main]\njobs:\n  a: {}\n";
    expect(await only(wf, STACKED)).toMatchObject({ job: "a", status: "run" });
  });

  it("names the stack target when `branches` declines", async () => {
    const wf = "on:\n  pull_request:\n    branches: [releases/*]\njobs:\n  a: {}\n";
    expect(await only(wf, STACKED)).toMatchObject({
      status: "no-dispatch",
      reason: "stack target 'main' not in branches",
    });
  });

  it("declines a stack target inside `branches-ignore`", async () => {
    const wf = "on:\n  pull_request:\n    branches-ignore: [main]\njobs:\n  a: {}\n";
    expect(await only(wf, STACKED)).toMatchObject({
      status: "no-dispatch",
      reason: "stack target 'main' in branches-ignore",
    });
  });

  it("keeps literal semantics when the preview sits on the base tip", async () => {
    const wf = "on:\n  pull_request:\n    branches: [dev]\njobs:\n  a: {}\n";
    const f: Fixture = {
      mergeSha: "m0",
      refs: { "o/r@m0": "m0", "o/r@main": "tip-main" },
      parents: { m0: ["tip-main"] },
      openPrs: [{ headRef: "main", baseRef: "dev", mergeSha: "m0" }],
    };
    expect(await only(wf, f)).toMatchObject({
      status: "no-dispatch",
      reason: "base branch 'main' not in branches",
    });
  });

  it("keeps literal semantics when no open PR owns the preview parent", async () => {
    // The preview parent is an old base tip, not any open PR's merge sha.
    const wf = "on:\n  pull_request:\n    branches: [dev]\njobs:\n  a: {}\n";
    const f: Fixture = {
      mergeSha: "m0",
      refs: { "o/r@m0": "m0", "o/r@main": "tip-main" },
      parents: { m0: ["old-tip"] },
      openPrs: [
        { headRef: "main", baseRef: "dev", mergeSha: "other" },
        { headRef: "elsewhere", baseRef: "dev", mergeSha: "old-tip" },
      ],
    };
    expect(await only(wf, f)).toMatchObject({
      status: "no-dispatch",
      reason: "base branch 'main' not in branches",
    });
  });

  it("keeps literal semantics when the preview cannot be read", async () => {
    // The merge sha 404s; the walk must not throw.
    const wf = "on:\n  pull_request:\n    branches: [dev]\njobs:\n  a: {}\n";
    expect(await only(wf, { mergeSha: "m0" })).toMatchObject({
      status: "no-dispatch",
      reason: "base branch 'main' not in branches",
    });
  });

  it("keeps literal semantics when the preview has no parents", async () => {
    const wf = "on:\n  pull_request:\n    branches: [dev]\njobs:\n  a: {}\n";
    const f: Fixture = { mergeSha: "m0", refs: { "o/r@m0": "m0" } };
    expect(await only(wf, f)).toMatchObject({
      status: "no-dispatch",
      reason: "base branch 'main' not in branches",
    });
  });

  it("stops the stack walk at the depth cap", async () => {
    // Ten hops in, the walk stops; filters run against the deepest proven target.
    const refs: Record<string, string> = {};
    const parents: Record<string, string[]> = {};
    const openPrs: NonNullable<Fixture["openPrs"]> = [];
    for (let i = 0; i <= 12; i++) {
      refs[`o/r@m${i}`] = `m${i}`;
      refs[`o/r@b${i}`] = `t${i}`;
      parents[`m${i}`] = [`m${i + 1}`];
      openPrs.push({ headRef: `b${i}`, baseRef: `b${i + 1}`, mergeSha: `m${i + 1}` });
    }
    const wf = "on:\n  pull_request:\n    branches: [main]\njobs:\n  a: {}\n";
    expect(
      await only(wf, { baseRef: "b0", mergeSha: "m0", refs, parents, openPrs }),
    ).toMatchObject({
      status: "no-dispatch",
      reason: "stack target 'b10' not in branches",
    });
  });
});

// ------------------------------------------------------------- repo-level pipeline

describe("predict", () => {
  it("reports a disabled workflow as no-dispatch without reading the file", async () => {
    const github = fakeGithub({
      workflows: [{ path: WF, state: "disabled_manually" }],
      contents: {},
    });
    const { entries } = await predict(github, "o/r", 1);
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
    const github = fakeGithub({
      workflows: [{ path: "dynamic/pages/pages-build-deployment", state: "active" }],
    });
    expect(await predict(github, "o/r", 1)).toEqual({
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

  it("reads the skip-checks trailer case-insensitively", async () => {
    const message = "feat: thing\n\nSKIP-CHECKS: TRUE\n";
    const { skip } = await run("on: pull_request\njobs:\n  a: {}\n", { message });
    expect(skip).toBe("head commit message contains a skip instruction");
  });

  it("does not suppress on a skip-checks mention that is not a trailer", async () => {
    const message = "feat: thing\n\nsee the docs on skip-checks: true handling\n";
    expect(await only("on: pull_request\njobs:\n  a: {}\n", { message })).toEqual({
      workflow: WF,
      job: "a",
      checkName: "a",
      status: "run",
      reason: "trigger matched",
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

// --------------------------------------------------- the commit that is read (#105)

describe("the commit workflow files are read at", () => {
  const AT_HEAD = "on: pull_request\njobs:\n  a: {}\n";
  const AT_MERGE = "on: pull_request\njobs:\n  a: {}\n  b: {}\n";

  const both: Fixture = {
    contents: { [WF]: AT_HEAD },
    mergeContents: { [WF]: AT_MERGE },
  };

  it("reads the test merge commit when GitHub offers one", async () => {
    const { checkNames } = await predict(
      fakeGithub({ ...both, mergeSha: MERGE_SHA }),
      "o/r",
      1,
    );
    expect(checkNames).toEqual(["a", "b"]);
  });

  it("falls back to the head when there is no test merge commit", async () => {
    const { checkNames } = await predict(fakeGithub({ ...both, mergeSha: null }), "o/r", 1);
    expect(checkNames).toEqual(["a"]);
  });

  it("names the test merge commit among the sources it read", async () => {
    const { sources } = await run(AT_HEAD, { mergeSha: MERGE_SHA });
    expect(sources).toEqual([HEAD_SOURCE, MERGE_SOURCE]);
  });

  it("names only the head when it fell back to the head", async () => {
    const { sources } = await run(AT_HEAD, { mergeSha: null });
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("expands each workflow under its own path at the commit it was read from", async () => {
    // The site is the identity the callback map will key on; a bare source
    // here would leave every top-level job nameless.
    vi.mocked(expandJobs).mockClear();
    await run(AT_HEAD, { mergeSha: null });
    expect(vi.mocked(expandJobs).mock.calls[0]?.[3]).toEqual({
      path: WF,
      source: HEAD_SOURCE,
    });
  });

  it("claims no merge commit on the skip path, which never reads one", async () => {
    const f = { mergeSha: MERGE_SHA, message: "chore: docs [skip ci]" };
    expect(await run(AT_HEAD, f)).toEqual({
      entries: [],
      checkNames: [],
      skip: "head commit message contains a skip instruction",
      sources: [HEAD_SOURCE],
    });
  });

  it("says which commit a missing workflow file was missing from", async () => {
    const github = fakeGithub({ contents: { [WF]: AT_HEAD }, mergeContents: {}, mergeSha: MERGE_SHA });
    const { entries } = await predict(github, "o/r", 1);
    expect(entries).toEqual([
      {
        workflow: WF,
        job: "*",
        checkName: null,
        status: "no-dispatch",
        reason: "no workflow file at the test merge commit",
      },
    ]);
  });

  it("still says `head` when that is the commit it read", async () => {
    const { entries } = await predict(fakeGithub({ contents: {}, mergeSha: null }), "o/r", 1);
    expect(entries).toMatchObject([{ reason: "no workflow file at head" }]);
  });
});

// ------------------------------------------------------------------ provenance

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
    const github = fakeGithub({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getContent = vi.spyOn(github, "getContent");
    await predict(github, "o/r", 1);
    expect(getContent).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "octo", repo: "repo", ref: REMOTE_SHA }),
    );
  });

  it("resolves a ref once however many jobs name it", async () => {
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: octo/repo/.github/workflows/x.yml@v1\n" +
      "  b:\n    uses: octo/repo/.github/workflows/x.yml@v1\n";
    const github = fakeGithub({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getCommit = vi.spyOn(github, "getCommit");
    const { sources } = await predict(github, "o/r", 1);
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
    const github = fakeGithub({ contents: { [WF]: body } });
    const getCommit = vi.spyOn(github, "getCommit");
    const { entries } = await predict(github, "o/r", 1);
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
    const github = fakeGithub({
      contents: { [WF]: body, ".github/workflows/x.yml": CALLEE },
      refs: { "octo/repo@v1": REMOTE_SHA },
    });
    const getContent = vi.spyOn(github, "getContent");
    await predict(github, "o/r", 1);
    // The caller's own workflow, then the callee once for both jobs.
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("fetches a callee named twice only once", async () => {
    const body =
      "on: pull_request\njobs:\n" +
      "  a:\n    uses: ./.github/workflows/sub.yml\n" +
      "  b:\n    uses: ./.github/workflows/sub.yml\n";
    const github = fakeGithub({
      contents: {
        [WF]: body,
        [SUB]: "on:\n  workflow_call:\njobs:\n  inner:\n    name: Inner\n",
      },
    });
    const spy = vi.spyOn(github, "getContent");
    const { entries } = await predict(github, "o/r", 1);
    expect(entries.map((e) => e.job)).toEqual(["a / Inner", "b / Inner"]);
    const subFetches = spy.mock.calls.filter((c) => c[0]?.path === SUB);
    expect(subFetches).toHaveLength(1);
  });
});

// ------------------------------------------------------- caller-supplied inputs

describe("a caller-supplied event action", () => {
  const runWith = (body: string, f: Fixture, opts: Parameters<typeof predict>[3]) =>
    predict(fakeGithub({ contents: { [WF]: body }, ...f }), "o/r", 1, opts);

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

// ------------------------------------------------------------------- callbacks

describe("callback commands", () => {
  const BODY = "on: pull_request\njobs:\n  a: {}\n";

  it("resolves the commands once and hands every expansion the one map", async () => {
    const map = { "o/r/.github/workflows/w.yml:a": [] };
    vi.mocked(resolveCallbackMap).mockResolvedValueOnce(map);
    vi.mocked(expandJobs).mockClear();
    await predict(fakeGithub({ contents: { [WF]: BODY } }), "o/r", 1, {
      callbacks: ["npx resolver"],
    });
    expect(resolveCallbackMap).toHaveBeenCalledWith(["npx resolver"]);
    expect(vi.mocked(expandJobs).mock.calls[0]?.[9]).toBe(map);
  });

  it("hands expansion no map at all when no callbacks were given", async () => {
    vi.mocked(expandJobs).mockClear();
    await predict(fakeGithub({ contents: { [WF]: BODY } }), "o/r", 1);
    expect(vi.mocked(expandJobs).mock.calls[0]?.[9]).toBeUndefined();
  });

  it("aborts the prediction when a callback fails", async () => {
    vi.mocked(resolveCallbackMap).mockRejectedValueOnce(new Error("callback 'r' exited 2"));
    await expect(
      predict(fakeGithub({ contents: { [WF]: BODY } }), "o/r", 1, { callbacks: ["r"] }),
    ).rejects.toThrow("callback 'r' exited 2");
  });
});

describe("github.repository as a prediction-wide fact", () => {
  it("decides a repository guard from the repo the PR is against", async () => {
    const wf = JSON.stringify({
      on: "pull_request",
      jobs: {
        published: { if: "github.repository != 'o/r'" },
        hermetic: { if: "github.repository == 'o/r'" },
      },
    });
    const { checkNames } = await predict(fakeGithub({ contents: { [WF]: wf } }), "o/r", 1);
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
    const github = fakeGithub({
      contents: { [WF]: wf, ".github/workflows/sub.yml": sub },
    });
    const { checkNames } = await predict(github, "o/r", 1);
    expect(checkNames).toEqual(["call / inner"]);
  });
});

describe("the executor seam through predict", () => {
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

  const coverEntry = async (f: Fixture, opts: Parameters<typeof predict>[3] = {}) => {
    const { entries } = await predict(
      fakeGithub({ contents: { [WF]: DYNAMIC }, ...f }),
      "o/r",
      1,
      opts,
    );
    expect(entries).toHaveLength(2);
    return entries[1];
  };

  it("executes by default, and says which execution failed when it does", async () => {
    // The fixture serves no tarball, so the default live executor fails to
    // materialize the workspace — and the entry that needed it names the failure.
    const e = await coverEntry({});
    expect(e).toMatchObject({
      status: "unknown",
      checkName: null,
      reason: `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${HEAD_SHA}`,
    });
  });

  it("says the same when the download yields something tar refuses", async () => {
    const e = await coverEntry({ tarballs: { [`o/r@${HEAD_SHA}`]: new Uint8Array([1, 2, 3]) } });
    expect(e).toMatchObject({
      status: "unknown",
      reason: `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${HEAD_SHA}`,
    });
  });

  it("materializes the workspace at the test merge commit (#105)", async () => {
    const e = await coverEntry({ mergeSha: MERGE_SHA });
    expect(e).toMatchObject({
      reason: `dynamic matrix; executing 'detect' failed: cannot materialize workspace o/r@${MERGE_SHA}`,
    });
  });

  it("turns execution off under executor: null", async () => {
    const e = await coverEntry({}, { executor: null });
    expect(e).toMatchObject({ status: "unknown", reason: "dynamic matrix" });
  });

  it("resolves the dynamic matrix through an injected executor", async () => {
    const executed: string[] = [];
    const { checkNames } = await predict(
      fakeGithub({ contents: { [WF]: DYNAMIC } }),
      "o/r",
      1,
      {
        executor: {
          executeJob: async (jobId) => {
            executed.push(jobId);
            return { ok: true, outputs: { langs: '["ts","py"]' } };
          },
        },
      },
    );
    // Only the job whose outputs a sibling reads was executed, and its
    // outputs turned the matrix into named entries.
    expect(executed).toEqual(["detect"]);
    expect(checkNames).toEqual(["Coverage (py)", "Coverage (ts)", "detect"]);
  });
});
