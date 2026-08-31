import { describe, expect, it, vi } from "vitest";
import type { GithubClient } from "willfire";
import { apiKey } from "../../../tests/fixtures/pinned/cassette.js";
import { makeRecordingClient } from "./makeRecordingClient.js";

// The key derivation is the contract the recorder and the replayer share, so
// it is exercised for real rather than stubbed.
vi.mock(
  "../../../tests/fixtures/pinned/cassette.js",
  async () =>
    await vi.importActual<typeof import("../../../tests/fixtures/pinned/cassette.js")>(
      "../../../tests/fixtures/pinned/cassette.js",
    ),
);

// Every payload carries a field willfire never reads, so a projection that
// stopped narrowing would show up as an extra key in the record.
const PULL = {
  base: { ref: "main", label: "o:main" },
  merge_commit_sha: "merge-sha",
  commits: 3,
  head: { sha: "head-sha", ref: "topic" },
  title: "unread",
};

const paginate = async () => [];

function liveOf(overrides: Record<string, unknown> = {}): GithubClient {
  const api = {
    rest: {
      pulls: {
        get: async () => ({ data: PULL }),
        list: async () => ({ data: [PULL, PULL] }),
        listFiles: async () => ({ data: [{ filename: "src/app.ts", status: "modified" }] }),
      },
      repos: {
        getCommit: async () => ({
          data: {
            sha: "c1",
            commit: { message: "feat: x", author: { name: "unread" } },
            parents: [{ sha: "p1", url: "unread" }],
          },
        }),
        getContent: async () => ({ data: "on: pull_request\n" }),
        downloadTarballArchive: vi.fn(async () => ({ data: new ArrayBuffer(4) })),
      },
      actions: {
        listRepoWorkflows: async () => ({
          data: [{ path: ".github/workflows/a.yml", state: "active", id: 7 }],
        }),
        listWorkflowRunsForRepo: vi.fn(async () => ({ data: [] })),
        listJobsForWorkflowRun: vi.fn(async () => ({ data: [] })),
      },
    },
    paginate,
    ...overrides,
  };
  return api as unknown as GithubClient;
}

const PAGE = { per_page: 100, page: 1 };

describe("makeRecordingClient", () => {
  it("records a pull as the base ref, merge commit, commit count and head sha", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    const { data } = await client.rest.pulls.get({ owner: "o", repo: "r", pull_number: 5 });
    expect(data).toBe(PULL);
    expect(api.get(apiKey("pulls.get", { owner: "o", repo: "r", pull_number: 5 }))).toEqual({
      key: "pulls.get owner=o pull_number=5 repo=r",
      data: {
        base: { ref: "main" },
        merge_commit_sha: "merge-sha",
        commits: 3,
        head: { sha: "head-sha" },
      },
    });
  });

  it("records a pull listing as base refs and merge commits only", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    await client.rest.pulls.list({ owner: "o", repo: "r", state: "open", head: "o:t", ...PAGE });
    expect(
      api.get(
        apiKey("pulls.list", {
          owner: "o",
          repo: "r",
          state: "open",
          head: "o:t",
          per_page: 100,
          page: 1,
        }),
      ),
    ).toEqual({
      key: "pulls.list head=o:t owner=o page=1 per_page=100 repo=r state=open",
      data: [
        { base: { ref: "main" }, merge_commit_sha: "merge-sha" },
        { base: { ref: "main" }, merge_commit_sha: "merge-sha" },
      ],
    });
  });

  it("records changed files as filenames only", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    await client.rest.pulls.listFiles({ owner: "o", repo: "r", pull_number: 5, ...PAGE });
    expect(
      api.get(
        apiKey("pulls.listFiles", {
          owner: "o",
          repo: "r",
          pull_number: 5,
          per_page: 100,
          page: 1,
        }),
      )?.data,
    ).toEqual([{ filename: "src/app.ts" }]);
  });

  it("records a commit as its sha, message and parent shas", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    await client.rest.repos.getCommit({ owner: "o", repo: "r", ref: "v0" });
    expect(api.get(apiKey("repos.getCommit", { owner: "o", repo: "r", ref: "v0" }))).toEqual({
      key: "repos.getCommit owner=o ref=v0 repo=r",
      data: { sha: "c1", commit: { message: "feat: x" }, parents: [{ sha: "p1" }] },
    });
  });

  it("records file contents verbatim", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    await client.rest.repos.getContent({ owner: "o", repo: "r", path: "w.yml", ref: "c1" });
    expect(
      api.get(apiKey("repos.getContent", { owner: "o", repo: "r", path: "w.yml", ref: "c1" }))
        ?.data,
    ).toBe("on: pull_request\n");
  });

  it("records the workflow listing as paths and states", async () => {
    const { client, api } = makeRecordingClient(liveOf());
    await client.rest.actions.listRepoWorkflows({ owner: "o", repo: "r", ...PAGE });
    expect(
      api.get(apiKey("actions.listRepoWorkflows", { owner: "o", repo: "r", ...PAGE }))?.data,
    ).toEqual([{ path: ".github/workflows/a.yml", state: "active" }]);
  });

  it("records the failure and rethrows it, because predict catches most reads", async () => {
    const live = liveOf();
    live.rest.repos.getContent = async () => {
      throw new Error("404 w.yml");
    };
    const { client, api } = makeRecordingClient(live);
    await expect(
      client.rest.repos.getContent({ owner: "o", repo: "r", path: "w.yml", ref: "c1" }),
    ).rejects.toThrow("404 w.yml");
    expect(
      api.get(apiKey("repos.getContent", { owner: "o", repo: "r", path: "w.yml", ref: "c1" })),
    ).toEqual({
      key: "repos.getContent owner=o path=w.yml ref=c1 repo=r",
      error: "Error: 404 w.yml",
    });
  });

  it("passes the tarball download and the run reads straight through, unrecorded", async () => {
    const live = liveOf();
    const { client, api } = makeRecordingClient(live);
    await client.rest.repos.downloadTarballArchive({ owner: "o", repo: "r", ref: "c1" });
    await client.rest.actions.listWorkflowRunsForRepo({
      owner: "o",
      repo: "r",
      head_sha: "c1",
      event: "pull_request",
      ...PAGE,
    });
    await client.rest.actions.listJobsForWorkflowRun({ owner: "o", repo: "r", run_id: 1, ...PAGE });
    expect(live.rest.repos.downloadTarballArchive).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      ref: "c1",
    });
    expect(live.rest.actions.listWorkflowRunsForRepo).toHaveBeenCalledOnce();
    expect(live.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledOnce();
    expect(api.size).toBe(0);
  });

  it("paginates with the live walk, since the routes it drives are the recording ones", () => {
    expect(makeRecordingClient(liveOf()).client.paginate).toBe(paginate);
  });
});
