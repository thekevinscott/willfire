// The global `fetch` is the one third-party edge this module reaches for.
// Stubbing it lets every route be driven without a network, and captures the
// exact URL and headers each one sends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGithubClient } from "./makeGithubClient.js";

const calls: { url: string; headers: Record<string, string> }[] = [];

/** Serve the staged responses in order; a request past the end fails loudly. */
const stage = (...responses: Response[]): void => {
  vi.stubGlobal("fetch", async (url: URL, init: { headers: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init.headers });
    return responses.shift();
  });
};

const json = (body: unknown): Response => new Response(JSON.stringify(body));

/** Reads GH_TOKEN="gh" from the suite's default environment. */
const client = makeGithubClient;

const REPO = { owner: "o", repo: "r" };

describe("makeGithubClient", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("GH_TOKEN", "gh");
    vi.stubEnv("GITHUB_TOKEN", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses to build a client with no token in the environment", () => {
    vi.stubEnv("GH_TOKEN", undefined);
    expect(() => makeGithubClient()).toThrow("GH_TOKEN or GITHUB_TOKEN must be set");
  });

  it("throws on an empty GH_TOKEN even with GITHUB_TOKEN set", () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "gha");
    expect(() => makeGithubClient()).toThrow("GH_TOKEN or GITHUB_TOKEN must be set");
  });

  it("sends GH_TOKEN as the bearer token, with the API headers", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gha");
    stage(json({}));
    await client().rest.pulls.get({ ...REPO, pull_number: 5 });
    expect(calls[0].headers).toEqual({
      accept: "application/vnd.github+json",
      authorization: "Bearer gh",
      "user-agent": "willfire",
      "x-github-api-version": "2022-11-28",
    });
  });

  it("falls back to GITHUB_TOKEN", async () => {
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", "gha");
    stage(json({}));
    await client().rest.pulls.get({ ...REPO, pull_number: 5 });
    expect(calls[0].headers.authorization).toBe("Bearer gha");
  });

  it("gets a pull request", async () => {
    const pr = { commits: 1, base: { ref: "main" }, head: { sha: "abc" }, merge_commit_sha: null };
    stage(json(pr));
    const { data } = await client().rest.pulls.get({ ...REPO, pull_number: 5 });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/pulls/5");
    expect(data).toEqual(pr);
  });

  it("lists pull requests with the filters in the query, omitting unset params", async () => {
    stage(json([{ base: { ref: "dev" }, merge_commit_sha: "m0" }]));
    const { data } = await client().rest.pulls.list({
      ...REPO,
      state: "open",
      head: "o:main",
      per_page: 100,
    });
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/pulls?state=open&head=o%3Amain&per_page=100",
    );
    expect(data).toEqual([{ base: { ref: "dev" }, merge_commit_sha: "m0" }]);
  });

  it("lists a pull request's files", async () => {
    stage(json([{ filename: "src/app.ts" }]));
    const { data } = await client().rest.pulls.listFiles({
      ...REPO,
      pull_number: 5,
      per_page: 2,
      page: 3,
    });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/pulls/5/files?per_page=2&page=3");
    expect(data).toEqual([{ filename: "src/app.ts" }]);
  });

  it("gets a commit", async () => {
    const commit = { sha: "abc", commit: { message: "m" }, parents: [] };
    stage(json(commit));
    const { data } = await client().rest.repos.getCommit({ ...REPO, ref: "abc" });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/commits/abc");
    expect(data).toEqual(commit);
  });

  it("reads a file as text via the raw media type", async () => {
    stage(new Response("on: pull_request\n"));
    const { data } = await client().rest.repos.getContent({
      ...REPO,
      path: ".github/workflows/w.yml",
      ref: "abc",
    });
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/contents/.github/workflows/w.yml?ref=abc",
    );
    expect(calls[0].headers.accept).toBe("application/vnd.github.raw+json");
    expect(data).toBe("on: pull_request\n");
  });

  it("downloads a tarball as an ArrayBuffer", async () => {
    stage(new Response(new Uint8Array([1, 2, 3])));
    const { data } = await client().rest.repos.downloadTarballArchive({ ...REPO, ref: "abc" });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/tarball/abc");
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("unwraps the workflows envelope", async () => {
    stage(json({ total_count: 1, workflows: [{ path: ".github/workflows/w.yml", state: "active" }] }));
    const { data } = await client().rest.actions.listRepoWorkflows({ ...REPO, per_page: 100 });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/actions/workflows?per_page=100");
    expect(data).toEqual([{ path: ".github/workflows/w.yml", state: "active" }]);
  });

  it("unwraps the workflow-runs envelope", async () => {
    const run = { id: 1, path: ".github/workflows/w.yml", status: "completed" };
    stage(json({ total_count: 1, workflow_runs: [run] }));
    const { data } = await client().rest.actions.listWorkflowRunsForRepo({
      ...REPO,
      head_sha: "abc",
      event: "pull_request",
    });
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/actions/runs?head_sha=abc&event=pull_request",
    );
    expect(data).toEqual([run]);
  });

  it("unwraps the jobs envelope", async () => {
    stage(json({ total_count: 1, jobs: [{ name: "a", conclusion: "success" }] }));
    const { data } = await client().rest.actions.listJobsForWorkflowRun({ ...REPO, run_id: 7 });
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/actions/runs/7/jobs");
    expect(data).toEqual([{ name: "a", conclusion: "success" }]);
  });

  it("throws on a non-2xx, naming the path and never the token", async () => {
    stage(new Response("gone", { status: 404 }));
    await expect(client().rest.pulls.get({ ...REPO, pull_number: 5 })).rejects.toThrow(
      /^GitHub API 404 for \/repos\/o\/r\/pulls\/5$/,
    );
  });

  it("paginates until a page comes back short", async () => {
    stage(
      json([{ filename: "a" }, { filename: "b" }]),
      json([{ filename: "c" }]),
    );
    const c = client();
    const files = await c.paginate(c.rest.pulls.listFiles, {
      ...REPO,
      pull_number: 5,
      per_page: 2,
    });
    expect(files).toEqual([{ filename: "a" }, { filename: "b" }, { filename: "c" }]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/pulls/5/files?per_page=2&page=1",
      "https://api.github.com/repos/o/r/pulls/5/files?per_page=2&page=2",
    ]);
  });

  it("paginates against GitHub's default page size when none is given", async () => {
    stage(json([{ filename: "a" }]));
    const c = client();
    const files = await c.paginate(c.rest.pulls.listFiles, { ...REPO, pull_number: 5 });
    expect(files).toEqual([{ filename: "a" }]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/pulls/5/files?page=1",
    ]);
  });
});
