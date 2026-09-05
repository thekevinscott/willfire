import { describe, expect, it, vi } from "vitest";
import type { GithubClient } from "willfire";
import { dispatchedChecks } from "./dispatchedChecks.js";

interface RunFixture {
  id: number;
  path: string;
  status?: string;
  jobs: { name: string; conclusion: string | null }[];
}

/** Every request the caller made, in order, so a case can assert the shape. */
const asked: [string, Record<string, unknown>][] = [];

function githubOf(runs: RunFixture[]): GithubClient {
  const api = {
    listWorkflowRuns: vi.fn(async (params: Record<string, unknown>) => {
      asked.push(["listWorkflowRuns", params]);
      return runs.map(({ id, path, status }) => ({ id, path, status: status ?? "completed" }));
    }),
    listRunJobs: vi.fn(async (params: Record<string, unknown>) => {
      asked.push(["listRunJobs", params]);
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
    asked.length = 0;
    const github = githubOf([{ id: 9, path: "a.yml", jobs: [] }]);
    await dispatchedChecks(github, "o", "r", "head-sha");
    expect(asked).toEqual([
      ["listWorkflowRuns", { owner: "o", repo: "r", head_sha: "head-sha", event: "pull_request" }],
      ["listRunJobs", { owner: "o", repo: "r", run_id: 9 }],
    ]);
  });

  it("reports nothing when the commit dispatched nothing", async () => {
    expect(await dispatchedChecks(githubOf([]), "o", "r", "head-sha")).toEqual({
      checks: [],
      incomplete: [],
    });
  });
});
