import { describe, expect, it, vi } from "vitest";
import type { GithubClient } from "willfire";
import { dispatchedChecks } from "./dispatchedChecks.js";

// Sentinels standing in for the paginating route methods: the caller hands the
// method itself to `paginate` and never calls it, so identity is all a stub needs.
const LIST_RUNS = Symbol("actions.listWorkflowRunsForRepo");
const LIST_JOBS = Symbol("actions.listJobsForWorkflowRun");

interface RunFixture {
  id: number;
  path: string;
  status?: string;
  jobs: { name: string; conclusion: string | null }[];
}

const paginated: { route: symbol; params: Record<string, unknown> }[] = [];

function githubOf(runs: RunFixture[]): GithubClient {
  const api = {
    rest: {
      actions: { listWorkflowRunsForRepo: LIST_RUNS, listJobsForWorkflowRun: LIST_JOBS },
    },
    paginate: vi.fn(async (route: symbol, params: Record<string, unknown>) => {
      paginated.push({ route, params });
      if (route === LIST_RUNS) {
        return runs.map(({ id, path, status }) => ({ id, path, status: status ?? "completed" }));
      }
      return runs.find((r) => r.id === params.run_id)?.jobs ?? [];
    }),
  };
  return api as unknown as GithubClient;
}

describe("dispatchedChecks", () => {
  it("flattens every job of every run into one check list", async () => {
    const github = githubOf([
      { id: 1, path: "a.yml", jobs: [{ name: "one", conclusion: "success" }] },
      {
        id: 2,
        path: "b.yml",
        jobs: [
          { name: "two", conclusion: "skipped" },
          { name: "three", conclusion: null },
        ],
      },
    ]);
    expect(await dispatchedChecks(github, "o", "r", "head-sha")).toEqual({
      checks: [
        { workflow: "a.yml", name: "one", conclusion: "success" },
        { workflow: "b.yml", name: "two", conclusion: "skipped" },
        { workflow: "b.yml", name: "three", conclusion: null },
      ],
      incomplete: [],
    });
  });

  it("names the workflow of every run that has not settled", async () => {
    const github = githubOf([
      { id: 1, path: "done.yml", jobs: [] },
      { id: 2, path: "running.yml", status: "in_progress", jobs: [] },
      { id: 3, path: "queued.yml", status: "queued", jobs: [] },
    ]);
    const { incomplete } = await dispatchedChecks(github, "o", "r", "head-sha");
    expect(incomplete).toEqual(["running.yml", "queued.yml"]);
  });

  it("asks only for the pull_request runs at the head commit", async () => {
    paginated.length = 0;
    const github = githubOf([{ id: 9, path: "a.yml", jobs: [] }]);
    await dispatchedChecks(github, "o", "r", "head-sha");
    expect(paginated).toEqual([
      {
        route: LIST_RUNS,
        params: {
          owner: "o",
          repo: "r",
          head_sha: "head-sha",
          event: "pull_request",
          per_page: 100,
        },
      },
      { route: LIST_JOBS, params: { owner: "o", repo: "r", run_id: 9, per_page: 100 } },
    ]);
  });

  it("reports nothing when the commit dispatched nothing", async () => {
    expect(await dispatchedChecks(githubOf([]), "o", "r", "head-sha")).toEqual({
      checks: [],
      incomplete: [],
    });
  });
});
