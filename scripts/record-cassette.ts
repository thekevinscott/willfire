// Regenerates one pinned cassette from a live dispatch. Needs GH_TOKEN (or
// GITHUB_TOKEN) and a working docker: job execution is captured by running the
// jobs the way `predict` runs them, not by describing what they would do.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeGithubClient, predict } from "../src/index.js";
import type { GithubClient } from "../src/index.js";
import type { GithubPullSummary } from "../src/predict/makeGithubClient.js";
import { makeLiveExecutor } from "../src/predict/makeLiveExecutor.js";
import {
  apiKey,
  execKey,
  predictedEntries,
  reconcile,
  type ApiData,
  type ApiParams,
  type ApiRecord,
  type Cassette,
  type DispatchedCheck,
  type ExecRecord,
} from "../tests/fixtures/pinned/cassette.js";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const repo = arg("--repo");
const prArg = arg("--pr");
const shape = arg("--shape");
if (repo === undefined || prArg === undefined || shape === undefined) {
  console.error('usage: record-cassette --repo owner/name --pr N --shape "what this pin holds"');
  process.exit(2);
}
const prNumber = Number(prArg);
const [owner, name] = repo.split("/");

const api = new Map<string, ApiRecord>();
const exec = new Map<string, ExecRecord>();

// `project` narrows a response to the fields `GithubClient` declares; failures
// are recorded too, since `predict` catches most of them by design.
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

const live = makeGithubClient();

const summary = (p: GithubPullSummary): GithubPullSummary => ({
  base: { ref: p.base.ref },
  merge_commit_sha: p.merge_commit_sha,
});

const recording: GithubClient = {
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
      // Deliberately not recorded: replay answers from the recorded execution
      // outcomes instead, so no cassette carries a repo tree.
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

const { data: pr } = await recording.rest.pulls.get({
  owner,
  repo: name,
  pull_number: prNumber,
});

// Mirrors the workspace `predict` builds — the test merge commit, falling back
// to head when the PR has none; the guard after the prediction catches the day
// that stops being true.
const mergeSha = pr.merge_commit_sha;
const readSha = mergeSha === null ? pr.head.sha : mergeSha;
const workspace = { owner, repo: name, ref: readSha, sha: readSha };
const resolveRef = async (src: { owner: string; repo: string; ref: string }) => {
  try {
    const { data } = await recording.rest.repos.getCommit({
      owner: src.owner,
      repo: src.repo,
      ref: src.ref,
    });
    return data.sha;
  } catch {
    return null;
  }
};
const liveExecutor = makeLiveExecutor(recording, workspace, resolveRef);
const executor = {
  executeJob: async (
    jobId: string,
    job: Parameters<typeof liveExecutor.executeJob>[1],
    wf: Parameters<typeof liveExecutor.executeJob>[2],
    scope: Parameters<typeof liveExecutor.executeJob>[3],
  ) => {
    const outcome = await liveExecutor.executeJob(jobId, job, wf, scope);
    const key = execKey(jobId, job, wf, scope);
    exec.set(key, { key, job: jobId, outcome });
    return outcome;
  },
};

const prediction = await predict(recording, repo, prNumber, { executor });

const workspaceSource = prediction.sources.find(
  (s) => s.owner === owner && s.repo === name && s.sha === workspace.sha,
);
if (workspaceSource === undefined) {
  console.error(
    `predict no longer reads ${repo} at ${workspace.sha}; update the workspace in record-cassette.ts`,
  );
  process.exit(1);
}

const runs = await recording.paginate(recording.rest.actions.listWorkflowRunsForRepo, {
  owner,
  repo: name,
  head_sha: pr.head.sha,
  event: "pull_request",
  per_page: 100,
});
const dispatched: DispatchedCheck[] = [];
for (const run of runs) {
  // An unfinished dispatch is not ground truth yet.
  if (run.status !== "completed") {
    console.error(`run for ${run.path} is ${run.status}; wait for the dispatch to settle`);
    process.exit(1);
  }
  const jobs = await recording.paginate(recording.rest.actions.listJobsForWorkflowRun, {
    owner,
    repo: name,
    run_id: run.id,
    per_page: 100,
  });
  for (const j of jobs) {
    dispatched.push({ workflow: run.path, name: j.name, conclusion: j.conclusion });
  }
}

// A cassette that disagrees with its own dispatch would pin a wrong answer as
// the expected one, so the recorder refuses to write it.
const entries = predictedEntries(prediction.entries);
const disagreements = reconcile(dispatched, entries);
if (disagreements.length > 0) {
  console.error(`prediction disagrees with the dispatch; refusing to record ${repo}#${prNumber}:`);
  for (const line of disagreements.sort()) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

const byName = (a: DispatchedCheck, b: DispatchedCheck) =>
  `${a.workflow} :: ${a.name}`.localeCompare(`${b.workflow} :: ${b.name}`);
const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);

const cassette: Cassette = {
  repo,
  pr: prNumber,
  shape,
  capturedAt: new Date().toISOString(),
  commits: { head: pr.head.sha, merge: pr.merge_commit_sha },
  dispatched: dispatched.sort(byName),
  predicted: {
    checkNames: prediction.checkNames,
    entries,
    sources: prediction.sources,
    skip: prediction.skip,
  },
  recording: {
    api: [...api.values()].sort(byKey),
    exec: [...exec.values()].sort(byKey),
  },
};

const out = fileURLToPath(
  new URL(`../tests/fixtures/pinned/${name}-${prNumber}.json`, import.meta.url),
);
await writeFile(out, `${JSON.stringify(cassette, null, 2)}\n`);
console.log(`wrote ${out}: ${dispatched.length} dispatched, ${api.size} reads, ${exec.size} runs`);
