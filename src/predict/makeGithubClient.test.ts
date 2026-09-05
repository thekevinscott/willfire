// Stubbing the global `fetch` drives every route without a network and
// captures the exact URL and headers each one sends.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeGithubClient } from "./makeGithubClient.js";

const calls: { url: string; headers: Record<string, string> }[] = [];

/** A request past the end of the staged responses fails loudly. */
const stage = (...responses: Response[]): void => {
  vi.stubGlobal("fetch", async (url: URL, init: { headers: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init.headers });
    return responses.shift();
  });
};

const json = <T>(body: T): Response => new Response(JSON.stringify(body));

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
    await client().getPull({ ...REPO, pull_number: 5 });
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
    await client().getPull({ ...REPO, pull_number: 5 });
    expect(calls[0].headers.authorization).toBe("Bearer gha");
  });

  it("gets a pull request", async () => {
    const pr = { commits: 1, base: { ref: "main" }, head: { sha: "abc" }, merge_commit_sha: null };
    stage(json(pr));
    expect(await client().getPull({ ...REPO, pull_number: 5 })).toEqual(pr);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/pulls/5");
  });

  it("lists pull requests with the filters in the query", async () => {
    const summary = { base: { ref: "dev" }, merge_commit_sha: "m0" };
    stage(json([summary]));
    expect(await client().listPulls({ ...REPO, state: "open", head: "o:main" })).toEqual([summary]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/pulls?state=open&head=o%3Amain&per_page=100&page=1",
    );
  });

  it("lists a pull request's files", async () => {
    stage(json([{ filename: "src/app.ts" }]));
    expect(await client().listPullFiles({ ...REPO, pull_number: 5 })).toEqual([
      { filename: "src/app.ts" },
    ]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1",
    );
  });

  it("gets a commit", async () => {
    const commit = { sha: "abc", commit: { message: "m" }, parents: [] };
    stage(json(commit));
    expect(await client().getCommit({ ...REPO, ref: "abc" })).toEqual(commit);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/commits/abc");
  });

  it("reads a file as text via the raw media type", async () => {
    stage(new Response("on: pull_request\n"));
    const body = await client().getContent({
      ...REPO,
      path: ".github/workflows/w.yml",
      ref: "abc",
    });
    expect(body).toBe("on: pull_request\n");
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/contents/.github/workflows/w.yml?ref=abc",
    );
    expect(calls[0].headers.accept).toBe("application/vnd.github.raw+json");
  });

  it("downloads a tarball as an ArrayBuffer", async () => {
    stage(new Response(new Uint8Array([1, 2, 3])));
    const tarball = await client().downloadTarball({ ...REPO, ref: "abc" });
    expect(new Uint8Array(tarball)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/tarball/abc");
  });

  it("unwraps the workflows envelope", async () => {
    const workflow = { path: ".github/workflows/w.yml", state: "active" };
    stage(json({ total_count: 1, workflows: [workflow] }));
    expect(await client().listWorkflows(REPO)).toEqual([workflow]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/actions/workflows?per_page=100&page=1",
    );
  });

  it("unwraps the workflow-runs envelope", async () => {
    const run = { id: 1, path: ".github/workflows/w.yml", status: "completed" };
    stage(json({ total_count: 1, workflow_runs: [run] }));
    const runs = await client().listWorkflowRuns({
      ...REPO,
      head_sha: "abc",
      event: "pull_request",
    });
    expect(runs).toEqual([run]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/actions/runs?head_sha=abc&event=pull_request&per_page=100&page=1",
    );
  });

  it("unwraps the jobs envelope", async () => {
    const job = { name: "a", conclusion: "success" };
    stage(json({ total_count: 1, jobs: [job] }));
    expect(await client().listRunJobs({ ...REPO, run_id: 7 })).toEqual([job]);
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/actions/runs/7/jobs?per_page=100&page=1",
    );
  });

  it("throws on a non-2xx, naming the path and never the token", async () => {
    stage(new Response("gone", { status: 404 }));
    await expect(client().getPull({ ...REPO, pull_number: 5 })).rejects.toThrow(
      /^GitHub API 404 for \/repos\/o\/r\/pulls\/5$/,
    );
  });

  it("keeps asking for pages until one comes back short", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}` }));
    stage(json(full), json([{ filename: "last" }]));
    const files = await client().listPullFiles({ ...REPO, pull_number: 5 });
    expect(files.map((f) => f.filename)).toEqual([...full.map((f) => f.filename), "last"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=1",
      "https://api.github.com/repos/o/r/pulls/5/files?per_page=100&page=2",
    ]);
  });
});
