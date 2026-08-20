// Unit suite for the prediction/reality comparison script.
//
// `verify.ts` is a top-level script: importing it *is* running it. So each case
// stands up the world it wants — argv, a stubbed `predict()`, and an Octokit
// stand-in for the workflow-run queries — then re-imports the module and reads
// back what it printed and the code it exited with.
//
// `./predict.js` is mocked because it is the collaborator this script is being
// isolated from; its own behavior is covered in `predict.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobName } from "./predict.js";
import type { Entry, JobEntry, WorkflowEntry } from "./predict.js";

const hoisted = vi.hoisted(() => ({
  makeOctokit: vi.fn(),
  predict: vi.fn(),
}));

vi.mock("./predict.js", async () => {
  const actual = await vi.importActual<typeof import("./predict.js")>("./predict.js");
  return { ...actual, makeOctokit: hoisted.makeOctokit, predict: hoisted.predict };
});

// ------------------------------------------------------------------ fixtures

// Sentinels standing in for the paginating route methods; the script passes the
// method itself to `octokit.paginate` and never calls it.
const LIST_RUNS = Symbol("actions.listWorkflowRunsForRepo");
const LIST_JOBS = Symbol("actions.listJobsForWorkflowRun");

interface RunFixture {
  id: number;
  path: string;
  /** Anything but "completed" makes the script warn that the run is in flight. */
  status?: string;
  jobs: { name: string; conclusion: string }[];
}

function fakeOctokit(runs: RunFixture[]): unknown {
  return {
    rest: {
      pulls: { get: async () => ({ data: { head: { sha: "deadbeef" } } }) },
      actions: {
        listWorkflowRunsForRepo: LIST_RUNS,
        listJobsForWorkflowRun: LIST_JOBS,
      },
    },
    paginate: async (route: symbol, params: { run_id?: number }) => {
      if (route === LIST_RUNS) {
        return runs.map(({ id, path, status }) => ({
          id,
          path,
          status: status ?? "completed",
        }));
      }
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

  beforeEach(() => {
    out = [];
    err = [];
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

    hoisted.makeOctokit.mockReturnValue(fakeOctokit(runs));
    hoisted.predict.mockResolvedValue({ entries: predicted, skip: null });
    process.argv = ["node", "/somewhere/verify.ts", ...args];
    vi.resetModules();
    await expect(import("./verify.js")).rejects.toBe(stop);
    return code;
  }

  it("exits 2 with a usage line when --repo or --pr is missing", async () => {
    expect(await invoke({ argv: ["--repo", "o/r"] })).toBe(2);
    expect(err[0]).toMatch(/^usage: verify /);
    expect(hoisted.predict).not.toHaveBeenCalled();
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

  it("does not judge an unpredicted entry from a workflow with an unknown in it", async () => {
    // A dynamic matrix or a non-local reusable call makes the whole workflow's
    // job list unknowable, so extra entries from it are not a miss.
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
    expect(out).toContain("  ?   w.yml :: surprise :: actual run, workflow had unknown prediction");
    expect(code).toBe(0);
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
    await invoke({
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

  it("reports an entry whose check name could not be resolved, and judges nothing", async () => {
    // #9 made the comparison key the resolved name, so an entry without one has
    // nothing to compare against. It is reported and its workflow is marked
    // unknown, which also stops the real checks in that workflow reading as
    // OVER — under-reporting beats a false failure.
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
      "  ?   w.yml :: a (18) :: actual run, workflow had unknown prediction",
      "  ?   w.yml :: a :: name unresolved: because",
      "PASS",
    ]);
    expect(code).toBe(0);
  });

  it("says nothing about a workflow-level entry that is already decided", async () => {
    const code = await invoke({ predicted: [wfEntry("w.yml", "no-dispatch")], runs: [] });
    expect(out).toEqual(["PASS"]);
    expect(code).toBe(0);
  });
});
