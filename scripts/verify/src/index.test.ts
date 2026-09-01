// Unit suite for the prediction/reality comparison script.
//
// The script is a top-level script: importing it *is* running it. So each case
// stands up the world it wants — argv, a stubbed `predict()`, and a GitHub client
// stand-in for the workflow-run queries — then re-imports the module and reads
// back what it printed and the code it exited with.
//
// `willfire` is mocked because it is the collaborator this script is being
// isolated from; its own behavior is covered in that package's own suite.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobName } from "willfire";
import type { Entry, JobEntry, WorkflowEntry } from "willfire";

const hoisted = vi.hoisted(() => ({
  makeGithubClient: vi.fn(),
  predict: vi.fn(),
}));

vi.mock("willfire", async () => {
  const actual = await vi.importActual<typeof import("willfire")>("willfire");
  return { ...actual, makeGithubClient: hoisted.makeGithubClient, predict: hoisted.predict };
});

// ------------------------------------------------------------------ fixtures

// Sentinels standing in for the paginating route methods; the script passes the
// method itself to `github.paginate` and never calls it.
const LIST_RUNS = Symbol("actions.listWorkflowRunsForRepo");
const LIST_JOBS = Symbol("actions.listJobsForWorkflowRun");

interface RunFixture {
  id: number;
  path: string;
  /** Anything but "completed" makes the script warn that the run is in flight. */
  status?: string;
  jobs: { name: string; conclusion: string }[];
}

/** Every request the script made, in order, so a case can assert the shape. */
type Call = [string, Record<string, unknown>];

function fakeGithub(runs: RunFixture[], calls: Call[] = []) {
  return {
    rest: {
      pulls: {
        get: async (params: Record<string, unknown>) => {
          calls.push(["pulls.get", params]);
          return { data: { head: { sha: "deadbeef" } } };
        },
      },
      actions: {
        listWorkflowRunsForRepo: LIST_RUNS,
        listJobsForWorkflowRun: LIST_JOBS,
      },
    },
    paginate: async (route: symbol, params: { run_id?: number }) => {
      if (route === LIST_RUNS) {
        calls.push(["listWorkflowRunsForRepo", params]);
        return runs.map(({ id, path, status }) => ({
          id,
          path,
          status: status ?? "completed",
        }));
      }
      calls.push(["listJobsForWorkflowRun", params]);
      return runs.find((r) => r.id === params.run_id)?.jobs ?? [];
    },
  };
}

interface Invocation {
  argv?: string[];
  predicted?: Entry[];
  runs?: RunFixture[];
}

// #9 made the comparison key the resolved check name rather than the job id, so
// `checkName` defaults to the job id here and is passed explicitly only when a
// case is about the two diverging — or about the name being unresolvable.
const entry = (
  workflow: string,
  job: string,
  status: JobEntry["status"],
  checkName: string | null = job,
): JobEntry => ({ workflow, job: jobName(job), checkName, status, reason: "because" });

// `jobName` refuses the workflow-level sentinel at the type level — that is what
// #11 bought — so the other variant needs its own constructor.
const wfEntry = (
  workflow: string,
  status: WorkflowEntry["status"],
): WorkflowEntry => ({ workflow, job: "*", checkName: null, status, reason: "because" });

describe("verify", () => {
  const argv = process.argv;
  let out: string[];
  let err: string[];
  let calls: Call[];

  beforeEach(() => {
    out = [];
    err = [];
    calls = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
  });

  afterEach(() => {
    process.argv = argv;
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  /** Run the script end to end and return what it printed and how it exited. */
  async function invoke({
    argv: args = ["--repo", "o/r", "--pr", "1"],
    predicted = [],
    runs = [],
  }: Invocation = {}): Promise<number | undefined> {
    let code: number | undefined;
    const stop = new Error("process.exit");
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      code = c;
      throw stop;
    }) as () => never);

    hoisted.makeGithubClient.mockReturnValue(fakeGithub(runs, calls));
    hoisted.predict.mockResolvedValue({ entries: predicted, skip: null });
    process.argv = ["node", "/somewhere/verify.ts", ...args];
    vi.resetModules();
    await expect(import("./index.js")).rejects.toBe(stop);
    return code;
  }

  it("exits 2 with a usage line when --repo or --pr is missing", async () => {
    expect(await invoke({ argv: ["--repo", "o/r"] })).toBe(2);
    expect(err[0]).toMatch(/^usage: verify /);
    expect(hoisted.predict).not.toHaveBeenCalled();
  });

  it("reads --repo and --pr off argv and asks GitHub about exactly that PR", async () => {
    await invoke({
      argv: ["--pr", "7", "--repo", "acme/widget"],
      runs: [{ id: 3, path: "w.yml", jobs: [{ name: "a", conclusion: "success" }] }],
    });
    expect(hoisted.predict.mock.calls[0].slice(1)).toEqual(["acme/widget", 7]);
    expect(calls).toEqual([
      ["pulls.get", { owner: "acme", repo: "widget", pull_number: 7 }],
      [
        "listWorkflowRunsForRepo",
        {
          owner: "acme",
          repo: "widget",
          head_sha: "deadbeef",
          event: "pull_request",
          per_page: 100,
        },
      ],
      ["listJobsForWorkflowRun", { owner: "acme", repo: "widget", run_id: 3, per_page: 100 }],
    ]);
  });

  it("passes when every predicted entry matches reality", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "a", "run")],
      runs: [{ id: 1, path: "w.yml", jobs: [{ name: "a", conclusion: "success" }] }],
    });
    expect(out).toEqual(["  OK  w.yml :: a :: run", "PASS"]);
    expect(code).toBe(0);
  });

  it("reads a skipped job conclusion as a skipped entry", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "a", "skipped")],
      runs: [{ id: 1, path: "w.yml", jobs: [{ name: "a", conclusion: "skipped" }] }],
    });
    expect(out).toEqual(["  OK  w.yml :: a :: skipped", "PASS"]);
    expect(code).toBe(0);
  });

  it("does not judge an entry it predicted as unknown", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "a", "unknown")],
      runs: [{ id: 1, path: "w.yml", jobs: [{ name: "a", conclusion: "success" }] }],
    });
    expect(out).toEqual(["  ?   w.yml :: a :: predicted unknown, actual run", "PASS"]);
    expect(code).toBe(0);
  });

  it("still misses an unpredicted entry from a workflow with an unknown in it", async () => {
    // A dynamic matrix or a non-local reusable call is why willfire could not
    // name the extra check; it is not a reason to stop counting it as a miss.
    const code = await invoke({
      predicted: [entry("w.yml", "known", "unknown")],
      runs: [
        {
          id: 1,
          path: "w.yml",
          jobs: [
            { name: "known", conclusion: "success" },
            { name: "surprise", conclusion: "success" },
          ],
        },
      ],
    });
    expect(out).toEqual([
      "  ?   w.yml :: known :: predicted unknown, actual run",
      "MISS  w.yml :: surprise :: ran (run) but was not predicted, workflow had an undecided entry",
      "FAIL",
    ]);
    expect(code).toBe(1);
  });

  it("misses a surprise with no note when the workflow was decided throughout", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "known", "run")],
      runs: [
        {
          id: 1,
          path: "w.yml",
          jobs: [
            { name: "known", conclusion: "success" },
            { name: "surprise", conclusion: "success" },
          ],
        },
      ],
    });
    expect(out).toEqual([
      "  OK  w.yml :: known :: run",
      "MISS  w.yml :: surprise :: ran (run) but was not predicted",
      "FAIL",
    ]);
    expect(code).toBe(1);
  });

  it("reports in sorted key order, not in the order the entries arrived", async () => {
    const code = await invoke({
      predicted: [entry("z.yml", "j", "run")],
      runs: [{ id: 1, path: "a.yml", jobs: [{ name: "x", conclusion: "success" }] }],
    });
    expect(out).toEqual([
      "MISS  a.yml :: x :: ran (run) but was not predicted",
      "OVER  z.yml :: j :: predicted run but never appeared",
      "FAIL",
    ]);
    expect(code).toBe(1);
  });

  it("fails on an entry that ran but was never predicted", async () => {
    const code = await invoke({
      predicted: [],
      runs: [{ id: 1, path: "w.yml", jobs: [{ name: "a", conclusion: "success" }] }],
    });
    expect(out).toEqual(["MISS  w.yml :: a :: ran (run) but was not predicted", "FAIL"]);
    expect(code).toBe(1);
  });

  it("fails on an entry that was predicted but never appeared", async () => {
    const code = await invoke({ predicted: [entry("w.yml", "a", "run")], runs: [] });
    expect(out).toEqual(["OVER  w.yml :: a :: predicted run but never appeared", "FAIL"]);
    expect(code).toBe(1);
  });

  it("fails on an entry whose status was predicted wrongly", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "a", "run")],
      runs: [{ id: 1, path: "w.yml", jobs: [{ name: "a", conclusion: "skipped" }] }],
    });
    expect(out).toEqual(["DIFF  w.yml :: a :: predicted run, actual skipped", "FAIL"]);
    expect(code).toBe(1);
  });

  it("warns when a run is still in flight", async () => {
    const code = await invoke({
      predicted: [entry("w.yml", "a", "run")],
      runs: [
        {
          id: 1,
          path: "w.yml",
          status: "in_progress",
          jobs: [{ name: "a", conclusion: "success" }],
        },
      ],
    });
    expect(out[0]).toBe("WARNING: runs still in progress: w.yml");
    expect(code).toBe(0);
  });

  // #11 closed the workflow-level variant so it cannot carry `unknown`, and
  // deleted the trailing "workflow-level unknown" report that existed to
  // surface one. What is left to pin down is that neither workflow-level
  // status leaks into the job comparison: `run` says a run exists, not that any
  // check entry does, so it must not read as a MISS.
  it("does not compare a dispatching workflow-level entry as a job", async () => {
    const code = await invoke({ predicted: [wfEntry("w.yml", "run")], runs: [] });
    expect(out).toEqual(["PASS"]);
    expect(code).toBe(0);
  });

  it("reports an entry whose check name could not be resolved, and misses the check", async () => {
    // #9 made the comparison key the resolved name, so an entry without one has
    // nothing to compare against. The check it failed to name still ran, so it
    // is a miss, annotated with why willfire could not match it.
    const code = await invoke({
      predicted: [entry("w.yml", "a", "run", null)],
      runs: [
        {
          id: 1,
          path: "w.yml",
          status: "completed",
          jobs: [{ name: "a (18)", conclusion: "success" }],
        },
      ],
    });
    expect(out).toEqual([
      "MISS  w.yml :: a (18) :: ran (run) but was not predicted, workflow had an undecided entry",
      "  ?   w.yml :: a :: name unresolved: because",
      "FAIL",
    ]);
    expect(code).toBe(1);
  });

  it("keeps the undecided note on the workflow that earned it", async () => {
    // An unresolved entry marks its own workflow undecided; a miss in a
    // different workflow carries no note.
    const code = await invoke({
      predicted: [entry("a.yml", "j", "run", null)],
      runs: [{ id: 1, path: "b.yml", jobs: [{ name: "x", conclusion: "success" }] }],
    });
    expect(out).toEqual([
      "MISS  b.yml :: x :: ran (run) but was not predicted",
      "  ?   a.yml :: j :: name unresolved: because",
      "FAIL",
    ]);
    expect(code).toBe(1);
  });

  it("says nothing about a workflow-level entry that is already decided", async () => {
    const code = await invoke({ predicted: [wfEntry("w.yml", "no-dispatch")], runs: [] });
    expect(out).toEqual(["PASS"]);
    expect(code).toBe(0);
  });
});
