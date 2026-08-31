// Plain `fetch`, shaped to mirror the octokit subset it replaced (#75) so call
// sites and their fakes carry over unchanged.

interface RepoParams {
  owner: string;
  repo: string;
}

interface PageParams {
  per_page?: number;
  page?: number;
}

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
  rest: {
    pulls: {
      get(params: RepoParams & { pull_number: number }): Promise<{ data: GithubPull }>;
      list(
        params: RepoParams & PageParams & { state: string; head: string },
      ): Promise<{ data: GithubPullSummary[] }>;
      listFiles(
        params: RepoParams & PageParams & { pull_number: number },
      ): Promise<{ data: GithubPullFile[] }>;
    };
    repos: {
      getCommit(params: RepoParams & { ref: string }): Promise<{ data: GithubCommit }>;
      getContent(params: RepoParams & { path: string; ref: string }): Promise<{ data: string }>;
      downloadTarballArchive(params: RepoParams & { ref: string }): Promise<{ data: ArrayBuffer }>;
    };
    actions: {
      listRepoWorkflows(params: RepoParams & PageParams): Promise<{ data: GithubWorkflow[] }>;
      listWorkflowRunsForRepo(
        params: RepoParams & PageParams & { head_sha: string; event: string },
      ): Promise<{ data: GithubWorkflowRun[] }>;
      listJobsForWorkflowRun(
        params: RepoParams & PageParams & { run_id: number },
      ): Promise<{ data: GithubJob[] }>;
    };
  };
  paginate<P extends PageParams, T>(
    route: (params: P) => Promise<{ data: T[] }>,
    params: P,
  ): Promise<T[]>;
}

export function makeGithubClient(): GithubClient {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN must be set");
  }

  const request = async (
    path: string,
    query: Record<string, string | number | undefined>,
    accept: string,
  ): Promise<Response> => {
    const url = new URL(`https://api.github.com${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
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
      throw new Error(`GitHub API ${res.status} for ${path}`);
    }
    return res;
  };

  const json = async <T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<{ data: T }> => {
    const res = await request(path, query, "application/vnd.github+json");
    return { data: (await res.json()) as T };
  };

  return {
    rest: {
      pulls: {
        get: ({ owner, repo, pull_number }) =>
          json<GithubPull>(`/repos/${owner}/${repo}/pulls/${pull_number}`),
        list: ({ owner, repo, state, head, per_page, page }) =>
          json<GithubPullSummary[]>(`/repos/${owner}/${repo}/pulls`, {
            state,
            head,
            per_page,
            page,
          }),
        listFiles: ({ owner, repo, pull_number, per_page, page }) =>
          json<GithubPullFile[]>(`/repos/${owner}/${repo}/pulls/${pull_number}/files`, {
            per_page,
            page,
          }),
      },
      repos: {
        getCommit: ({ owner, repo, ref }) =>
          json<GithubCommit>(`/repos/${owner}/${repo}/commits/${ref}`),
        getContent: async ({ owner, repo, path, ref }) => {
          const res = await request(
            `/repos/${owner}/${repo}/contents/${path}`,
            { ref },
            "application/vnd.github.raw+json",
          );
          return { data: await res.text() };
        },
        // 302 to a short-lived codeload URL; fetch follows it, and undici
        // drops the authorization header on the cross-origin hop.
        downloadTarballArchive: async ({ owner, repo, ref }) => {
          const res = await request(
            `/repos/${owner}/${repo}/tarball/${ref}`,
            {},
            "application/vnd.github+json",
          );
          return { data: await res.arrayBuffer() };
        },
      },
      actions: {
        // The actions list endpoints wrap their arrays in an envelope; unwrap
        // here so `paginate` sees one shape everywhere.
        listRepoWorkflows: async ({ owner, repo, per_page, page }) => {
          const { data } = await json<{ workflows: GithubWorkflow[] }>(
            `/repos/${owner}/${repo}/actions/workflows`,
            { per_page, page },
          );
          return { data: data.workflows };
        },
        listWorkflowRunsForRepo: async ({ owner, repo, head_sha, event, per_page, page }) => {
          const { data } = await json<{ workflow_runs: GithubWorkflowRun[] }>(
            `/repos/${owner}/${repo}/actions/runs`,
            { head_sha, event, per_page, page },
          );
          return { data: data.workflow_runs };
        },
        listJobsForWorkflowRun: async ({ owner, repo, run_id, per_page, page }) => {
          const { data } = await json<{ jobs: GithubJob[] }>(
            `/repos/${owner}/${repo}/actions/runs/${run_id}/jobs`,
            { per_page, page },
          );
          return { data: data.jobs };
        },
      },
    },
    // A short page ends the walk. An exact page boundary costs one extra empty
    // request, which keeps this free of Link-header parsing.
    paginate: async (route, params) => {
      const perPage = params.per_page ?? 30;
      const all = [];
      let page = 1;
      let full = true;
      while (full) {
        const { data } = await route({ ...params, page });
        all.push(...data);
        full = data.length === perPage;
        page += 1;
      }
      return all;
    },
  };
}
