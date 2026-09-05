// The GitHub REST surface willfire uses: a handful of GET endpoints plus the
// tarball download, over plain `fetch`. Every `list*` method returns every page.

import { githubApiError } from "./githubApiError.js";

interface RepoParams {
  owner: string;
  repo: string;
}

type Query = Record<string, string | number>;

/** Response types carry only the fields willfire actually reads. */
export interface GithubPullSummary {
  base: { ref: string };
  merge_commit_sha: string | null;
}

export interface GithubPull extends GithubPullSummary {
  commits: number;
  head: { sha: string };
}

export interface GithubPullFile {
  filename: string;
}

export interface GithubCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
}

export interface GithubWorkflow {
  path: string;
  state: string;
}

export interface GithubWorkflowRun {
  id: number;
  path: string;
  status: string | null;
}

export interface GithubJob {
  name: string;
  conclusion: string | null;
}

export interface GithubClient {
  getPull(params: RepoParams & { pull_number: number }): Promise<GithubPull>;
  listPulls(params: RepoParams & { state: string; head: string }): Promise<GithubPullSummary[]>;
  listPullFiles(params: RepoParams & { pull_number: number }): Promise<GithubPullFile[]>;
  getCommit(params: RepoParams & { ref: string }): Promise<GithubCommit>;
  getContent(params: RepoParams & { path: string; ref: string }): Promise<string>;
  downloadTarball(params: RepoParams & { ref: string }): Promise<ArrayBuffer>;
  listWorkflows(params: RepoParams): Promise<GithubWorkflow[]>;
  listWorkflowRuns(
    params: RepoParams & { head_sha: string; event: string },
  ): Promise<GithubWorkflowRun[]>;
  listRunJobs(params: RepoParams & { run_id: number }): Promise<GithubJob[]>;
}

const PER_PAGE = 100;

export function makeGithubClient(): GithubClient {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN must be set");
  }

  const request = async (path: string, query: Query, accept: string): Promise<Response> => {
    const url = new URL(`https://api.github.com${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, {
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        // GitHub rejects requests without a User-Agent.
        "user-agent": "willfire",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) {
      // A consumer surfaces this message verbatim as its gate's failure text,
      // so it names the repo and path via the URL and the ref via the query.
      throw githubApiError(
        res.status,
        `${url.pathname}${url.search}`,
        Object.fromEntries(res.headers),
      );
    }
    return res;
  };

  const json = async <T>(path: string, query: Query = {}): Promise<T> => {
    const res = await request(path, query, "application/vnd.github+json");
    return (await res.json()) as T;
  };

  // A short page ends the walk. A count landing exactly on a page boundary
  // costs one extra empty request, which keeps this free of Link-header
  // parsing. `pick` is where the actions endpoints shed their envelope.
  const pages = async <B, T>(
    path: string,
    pick: (body: B) => T[],
    query: Query = {},
  ): Promise<T[]> => {
    const all: T[] = [];
    let page = 1;
    let full = true;
    while (full) {
      const items = pick(await json<B>(path, { ...query, per_page: PER_PAGE, page }));
      all.push(...items);
      full = items.length === PER_PAGE;
      page += 1;
    }
    return all;
  };

  return {
    getPull: ({ owner, repo, pull_number }) =>
      json<GithubPull>(`/repos/${owner}/${repo}/pulls/${pull_number}`),
    listPulls: ({ owner, repo, state, head }) =>
      pages(`/repos/${owner}/${repo}/pulls`, (b: GithubPullSummary[]) => b, { state, head }),
    listPullFiles: ({ owner, repo, pull_number }) =>
      pages(`/repos/${owner}/${repo}/pulls/${pull_number}/files`, (b: GithubPullFile[]) => b),
    getCommit: ({ owner, repo, ref }) =>
      json<GithubCommit>(`/repos/${owner}/${repo}/commits/${ref}`),
    getContent: async ({ owner, repo, path, ref }) => {
      const res = await request(
        `/repos/${owner}/${repo}/contents/${path}`,
        { ref },
        "application/vnd.github.raw+json",
      );
      return res.text();
    },
    // 302 to a short-lived codeload URL; fetch follows it, and undici drops
    // the authorization header on the cross-origin hop.
    downloadTarball: async ({ owner, repo, ref }) => {
      const res = await request(
        `/repos/${owner}/${repo}/tarball/${ref}`,
        {},
        "application/vnd.github+json",
      );
      return res.arrayBuffer();
    },
    listWorkflows: ({ owner, repo }) =>
      pages(
        `/repos/${owner}/${repo}/actions/workflows`,
        (b: { workflows: GithubWorkflow[] }) => b.workflows,
      ),
    listWorkflowRuns: ({ owner, repo, head_sha, event }) =>
      pages(
        `/repos/${owner}/${repo}/actions/runs`,
        (b: { workflow_runs: GithubWorkflowRun[] }) => b.workflow_runs,
        { head_sha, event },
      ),
    listRunJobs: ({ owner, repo, run_id }) =>
      pages(
        `/repos/${owner}/${repo}/actions/runs/${run_id}/jobs`,
        (b: { jobs: GithubJob[] }) => b.jobs,
      ),
  };
}
