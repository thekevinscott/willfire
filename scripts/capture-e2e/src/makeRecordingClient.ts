import type { GithubClient } from "willfire";
import type { GithubPullSummary } from "willfire/internal";
import {
  apiKey,
  type ApiData,
  type ApiParams,
  type ApiRecord,
} from "../../../tests/fixtures/pinned/capture.js";

/**
 * A `GithubClient` that answers from the live one and keeps what it saw.
 *
 * Failures are recorded too, since `predict` catches most of them by design and
 * a capture that dropped them would replay a different prediction. The tarball
 * download and the workflow-run reads are passed through unrecorded: replay
 * answers execution from the recorded outcomes, so no capture carries a repo
 * tree, and the dispatch is stored as `dispatched` rather than as raw reads.
 */
export function makeRecordingClient(live: GithubClient): {
  client: GithubClient;
  api: Map<string, ApiRecord>;
} {
  const api = new Map<string, ApiRecord>();
  // `project` narrows a response to the fields `GithubClient` declares, so a
  // capture holds no field willfire never reads.
  const record = async <T extends ApiData>(
    call: string,
    params: ApiParams,
    run: () => Promise<{ data: T }>,
    project: (data: T) => T,
  ): Promise<{ data: T }> => {
    const key = apiKey(call, params);
    try {
      const res = await run();
      api.set(key, { key, data: project(res.data) });
      return res;
    } catch (e) {
      api.set(key, { key, error: String(e) });
      throw e;
    }
  };
  const summary = (p: GithubPullSummary): GithubPullSummary => ({
    base: { ref: p.base.ref },
    merge_commit_sha: p.merge_commit_sha,
  });
  const client: GithubClient = {
    rest: {
      pulls: {
        get: (p) =>
          record(
            "pulls.get",
            { owner: p.owner, repo: p.repo, pull_number: p.pull_number },
            () => live.rest.pulls.get(p),
            (d) => ({ ...summary(d), commits: d.commits, head: { sha: d.head.sha } }),
          ),
        list: (p) =>
          record(
            "pulls.list",
            {
              owner: p.owner,
              repo: p.repo,
              state: p.state,
              head: p.head,
              per_page: p.per_page,
              page: p.page,
            },
            () => live.rest.pulls.list(p),
            (d) => d.map(summary),
          ),
        listFiles: (p) =>
          record(
            "pulls.listFiles",
            {
              owner: p.owner,
              repo: p.repo,
              pull_number: p.pull_number,
              per_page: p.per_page,
              page: p.page,
            },
            () => live.rest.pulls.listFiles(p),
            (d) => d.map((f) => ({ filename: f.filename })),
          ),
      },
      repos: {
        getCommit: (p) =>
          record(
            "repos.getCommit",
            { owner: p.owner, repo: p.repo, ref: p.ref },
            () => live.rest.repos.getCommit(p),
            (d) => ({
              sha: d.sha,
              commit: { message: d.commit.message },
              parents: d.parents.map((x) => ({ sha: x.sha })),
            }),
          ),
        getContent: (p) =>
          record(
            "repos.getContent",
            { owner: p.owner, repo: p.repo, path: p.path, ref: p.ref },
            () => live.rest.repos.getContent(p),
            (d) => d,
          ),
        downloadTarballArchive: (p) => live.rest.repos.downloadTarballArchive(p),
      },
      actions: {
        listRepoWorkflows: (p) =>
          record(
            "actions.listRepoWorkflows",
            { owner: p.owner, repo: p.repo, per_page: p.per_page, page: p.page },
            () => live.rest.actions.listRepoWorkflows(p),
            (d) => d.map((w) => ({ path: w.path, state: w.state })),
          ),
        listWorkflowRunsForRepo: (p) => live.rest.actions.listWorkflowRunsForRepo(p),
        listJobsForWorkflowRun: (p) => live.rest.actions.listJobsForWorkflowRun(p),
      },
    },
    paginate: live.paginate,
  };
  return { client, api };
}
