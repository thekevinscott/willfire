import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { predict } from "./predict.js";
import type { Entry, Prediction } from "../types.js";

const WF = ".github/workflows/w.yml";
const SUB = ".github/workflows/sub.yml";

interface Fixture {
  commits?: number;
  baseRef?: string;
  files?: string[];
  message?: string;
  workflows?: { path: string; state: string }[];
  contents?: Record<string, string>;
  refs?: Record<string, string>;
  tarballs?: Record<string, Uint8Array>;
  mergeSha?: string | null;
  parents?: Record<string, string[]>;
  openPrs?: { headRef: string; baseRef: string; mergeSha: string | null }[];
}

const HEAD_SHA = "deadbeef";

const HEAD_SOURCE = { owner: "o", repo: "r", ref: HEAD_SHA, sha: HEAD_SHA };

const REMOTE_SHA = "b".repeat(40);

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
            merge_commit_sha: f.mergeSha ?? null,
          },
        }),
        list: async ({ head }: { head: string }) => ({
          data: (f.openPrs ?? [])
            .filter((p) => `o:${p.headRef}` === head)
            .map((p) => ({ base: { ref: p.baseRef }, merge_commit_sha: p.mergeSha })),
        }),
        listFiles: LIST_FILES,
      },
      repos: {
        getCommit: async ({ owner, repo, ref }: { owner: string; repo: string; ref: string }) => {
          if (ref === HEAD_SHA) {
            return { data: { sha: ref, commit: { message: f.message ?? "chore: routine" } } };
          }
          const sha = (f.refs ?? {})[`${owner}/${repo}@${ref}`];
          if (sha == null) {
            throw new Error(`404 ${owner}/${repo}@${ref}`);
          }
          const parents = ((f.parents ?? {})[sha] ?? []).map((p) => ({ sha: p }));
          return { data: { sha, commit: { message: "" }, parents } };
        },
        getContent: async ({ path }: { path: string }) => {
          if (!(path in contents)) {
            throw new Error(`404 ${path}`);
          }
          return { data: contents[path] };
        },
        downloadTarballArchive: async ({ owner, repo, ref }: Record<string, string>) => {
          const bytes = (f.tarballs ?? {})[`${owner}/${repo}@${ref}`];
          if (bytes == null) {
            throw new Error(`404 tarball ${owner}/${repo}@${ref}`);
          }
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

function run(body: string, f: Fixture = {}): Promise<Prediction> {
  return predict(fakeOctokit({ contents: { [WF]: body }, ...f }), "o/r", 1);
}

async function only(body: string, f: Fixture = {}): Promise<Entry> {
  const { entries } = await run(body, f);
  expect(entries).toHaveLength(1);
  return entries[0];
}

describe("workflow-level verdicts", () => {
  it("declines a workflow with no `on` key", async () => {
    expect(await only("jobs:\n  a:\n    runs-on: ubuntu-latest\n")).toMatchObject({
      job: "*",
      status: "no-dispatch",
      reason: "no pull_request trigger",
    });
  });

  it("declines a workflow whose `on` is an unusable scalar", async () => {
    expect(await only("on: true\njobs:\n  a: {}\n")).toMatchObject({
      status: "no-dispatch",
      reason: "no pull_request trigger",
    });
  });

  it("reads the YAML 1.1 boolean-key spelling of `on`", async () => {
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
    const wf =
      "on:\n  pull_request:\n    branches: [dev]\n    branches-ignore: [dev]\njobs:\n  a: {}\n";
    expect(await only(wf, { baseRef: "main" })).toMatchObject({ status: "run" });
  });

  it("reports a workflow with no file at head as no-dispatch (#7)", async () => {
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
    const entry = await only("on: pull_request\njobs:\n  a: [\n");
    expect(entry.job).toBe("*");
    expect(entry.status).toBe("run");
    expect(entry.reason).toMatch(/^YAML parse error: /);
  });

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
      sources: [HEAD_SOURCE],
    });
  });

  it("suppresses everything on a skip-checks trailer", async () => {
    const message = "feat: thing\n\nskip-checks: true\n";
    expect(await run("on: pull_request\njobs:\n  a: {}\n", { message })).toEqual({
      entries: [],
      checkNames: [],
      skip: "head commit message contains a skip instruction",
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

describe("the commits a prediction was read from", () => {
  const caller = (uses: string) => `on: pull_request\njobs:\n  call:\n    uses: ${uses}\n`;

  const CALLEE = "on:\n  workflow_call:\njobs:\n  inner:\n    runs-on: ubuntu-latest\n";

  it("names only the head when nothing else is read", async () => {
    const { sources } = await run("on: pull_request\njobs:\n  a: {}\n");
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("does not name a second source for a local `./` call", async () => {
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
      { owner: "octo", repo: "repo", ref: "v1", sha: REMOTE_SHA },
    ]);
  });

  it("does not name a source whose ref would not resolve", async () => {
    const body = caller("octo/repo/.github/workflows/x.yml@v1");
    const { sources } = await run(body, { contents: { [WF]: body } });
    expect(sources).toEqual([HEAD_SOURCE]);
  });

  it("reads a callee at the resolved commit, never at the ref that named it", async () => {
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
    expect(getContent).toHaveBeenCalledTimes(2);
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

describe("a caller-supplied event action", () => {
  const runWith = (body: string, f: Fixture, opts: Parameters<typeof predict>[3]) =>
    predict(fakeOctokit({ contents: { [WF]: body }, ...f }), "o/r", 1, opts);

  const onTypes = (types: string) =>
    `on:\n  pull_request:\n    types: [${types}]\njobs:\n  a: {}\n`;

  it("beats the heuristic when the PR has several commits but was just opened", async () => {
    const { entries } = await runWith(onTypes("opened"), { commits: 3 }, { action: "opened" });
    expect(entries).toMatchObject([{ job: "a", status: "run" }]);
  });

  it("beats the heuristic when a force-push left one commit", async () => {
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
