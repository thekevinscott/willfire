/**
 * The pinned-PR capture: one live dispatch, captured whole.
 *
 * `scripts/capture-e2e/` writes one per pinned PR and
 * `tests/integration/pinned-dispatches.test.ts` replays it with no network and
 * no docker. A capture is a record of observed GitHub behaviour, in the same
 * sense `tests/fixtures/willrun-probe/` is: every field was read off a real
 * dispatch, so editing one is a claim that GitHub changed. See `README.md` in
 * this directory.
 */

import { createHash } from "node:crypto";
import type { Entry, ExecOutcome, JobExecutor, WorkflowSource } from "../../../src/index.js";
import type {
  GithubClient,
  GithubCommit,
  GithubPull,
  GithubPullFile,
  GithubPullSummary,
  GithubWorkflow,
} from "../../../src/predict/makeGithubClient.js";

/** Params as the call site spells them; `undefined` entries are dropped from the key. */
export type ApiParams = Record<string, string | number | undefined>;

/** Every response shape the recorded GitHub reads can answer with. */
export type ApiData =
  | string
  | GithubPull
  | GithubCommit
  | GithubPullSummary[]
  | GithubPullFile[]
  | GithubWorkflow[];

/**
 * One recorded read. `error` instead of `data` is not a recording defect: a
 * deleted tag or a private repo is a real answer, and `predict` turns it into
 * an `unknown` entry rather than throwing.
 */
export interface ApiRecord {
  key: string;
  data?: ApiData;
  error?: string;
}

/** One recorded job execution — what running the job yielded, not whether it runs. */
export interface ExecRecord {
  key: string;
  job: string;
  outcome: ExecOutcome;
}

/** One check GitHub actually created for the pinned dispatch. */
export interface DispatchedCheck {
  workflow: string;
  name: string;
  conclusion: string | null;
}

/**
 * One prediction verdict, recorded explicitly — `unknown` included. A pin that
 * degrades from a decided verdict to `unknown` changes this list and fails,
 * which is the whole point of recording status per entry rather than a
 * pass/fail summary.
 */
export interface PredictedEntry {
  workflow: string;
  job: string;
  checkName: string | null;
  status: string;
  /**
   * Carried only where the verdict is undecided. A decided entry's reason is
   * prose that gets reworded by refactors; an undecided one's reason is the
   * evidence that it is undecided for the modelled cause and not because the
   * recorder's docker or network was broken.
   */
  reason?: string;
}

export interface E2ECapture {
  repo: string;
  pr: number;
  /** Which workflow shape this pin exists to hold — read by humans, not by code. */
  shape: string;
  capturedAt: string;
  /** Both commits, because prediction reads at the merge commit and falls back to head. */
  commits: { head: string; merge: string | null };
  /** Ground truth: every check the dispatch created, skipped ones included. */
  dispatched: DispatchedCheck[];
  predicted: {
    checkNames: string[];
    entries: PredictedEntry[];
    sources: WorkflowSource[];
    skip: string | null;
  };
  recording: { api: ApiRecord[]; exec: ExecRecord[] };
}

/** Stable identity of one read: the call plus its params, key-sorted. */
export const apiKey = (call: string, params: ApiParams): string => {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);
  return `${call} ${pairs.join(" ")}`;
};

/**
 * Stable identity of one job execution. Derived from the executor's own
 * arguments so the recorder and the replayer cannot drift apart, and hashed
 * because the arguments include whole parsed job trees.
 */
export const execKey: (...args: Parameters<JobExecutor["executeJob"]>) => string = (
  jobId,
  job,
  wf,
  scope,
) =>
  createHash("sha256")
    .update(JSON.stringify([jobId, job, wf?.env ?? null, scope]))
    .digest("hex")
    .slice(0, 16);

/**
 * A prediction's entries in the shape the capture stores, built the same way
 * at record time and at assert time so the two cannot disagree about format.
 */
export const predictedEntries = (entries: Entry[]): PredictedEntry[] =>
  entries.map((e) => {
    const base: PredictedEntry = {
      workflow: e.workflow,
      job: e.job,
      checkName: e.checkName,
      status: e.status,
    };
    const undecided = e.status === "unknown" || (e.job !== "*" && e.checkName === null);
    return undecided ? { ...base, reason: e.reason } : base;
  });

/**
 * Where a prediction and the dispatch it is pinned to disagree, one line each.
 *
 * The recorder refuses to write a capture this finds anything in, and the test
 * asserts it stays empty — so no capture can encode a prediction that was
 * already wrong when it was captured. An `unknown` entry is not a disagreement:
 * it is willfire declining to answer, which the fixture records as such.
 */
export function reconcile(dispatched: DispatchedCheck[], entries: PredictedEntry[]): string[] {
  const actual = new Map(
    dispatched.map((d) => [
      `${d.workflow} :: ${d.name}`,
      d.conclusion === "skipped" ? "skipped" : "run",
    ]),
  );
  const named = entries.filter((e) => e.job !== "*" && e.checkName !== null);
  const predicted = new Map(named.map((e) => [`${e.workflow} :: ${e.checkName}`, e.status]));
  // A workflow willfire could not fully settle explains every extra check it
  // dispatched, so a name missing from an undecided workflow is not a miss.
  const undecided = new Set(
    entries
      .filter((e) => e.status === "unknown" || (e.job !== "*" && e.checkName === null))
      .map((e) => e.workflow),
  );
  const out: string[] = [];
  for (const [key, a] of actual) {
    const p = predicted.get(key);
    if (p === undefined) {
      if (!undecided.has(key.split(" :: ")[0])) {
        out.push(`MISS ${key} :: dispatched ${a}, not predicted`);
      }
    } else if (p !== a && p !== "unknown") {
      out.push(`DIFF ${key} :: predicted ${p}, dispatched ${a}`);
    }
  }
  for (const [key, p] of predicted) {
    if (!actual.has(key) && p !== "unknown") {
      out.push(`OVER ${key} :: predicted ${p}, never dispatched`);
    }
  }
  return out.sort();
}

/**
 * A `GithubClient` that answers only from the capture.
 *
 * Misses are collected rather than thrown, because `predict` catches read
 * failures by design and would quietly turn a gap in the recording into an
 * `unknown` entry. The test asserts the list is empty, so an incomplete
 * capture fails loudly instead.
 */
export function replayClient(capture: E2ECapture): { client: GithubClient; misses: string[] } {
  const byKey = new Map(capture.recording.api.map((r) => [r.key, r]));
  const misses: string[] = [];
  const lookup = (call: string, params: ApiParams): ApiData => {
    const key = apiKey(call, params);
    const rec = byKey.get(key);
    if (rec === undefined) {
      misses.push(key);
      throw new Error(`capture miss: ${key}`);
    }
    if (rec.data === undefined) {
      throw new Error(rec.error ?? `capture record has neither data nor error: ${key}`);
    }
    return rec.data;
  };
  const client: GithubClient = {
    rest: {
      pulls: {
        get: async ({ owner, repo, pull_number }) => ({
          data: lookup("pulls.get", { owner, repo, pull_number }) as GithubPull,
        }),
        list: async ({ owner, repo, state, head, per_page, page }) => ({
          data: lookup("pulls.list", {
            owner,
            repo,
            state,
            head,
            per_page,
            page,
          }) as GithubPullSummary[],
        }),
        listFiles: async ({ owner, repo, pull_number, per_page, page }) => ({
          data: lookup("pulls.listFiles", {
            owner,
            repo,
            pull_number,
            per_page,
            page,
          }) as GithubPullFile[],
        }),
      },
      repos: {
        getCommit: async ({ owner, repo, ref }) => ({
          data: lookup("repos.getCommit", { owner, repo, ref }) as GithubCommit,
        }),
        getContent: async ({ owner, repo, path, ref }) => ({
          data: lookup("repos.getContent", { owner, repo, path, ref }) as string,
        }),
        // Never recorded: job execution is replayed from `exec`, so no tree is
        // ever materialized offline.
        downloadTarballArchive: async ({ owner, repo, ref }) => {
          misses.push(apiKey("repos.downloadTarballArchive", { owner, repo, ref }));
          throw new Error("tarball downloads are not replayable");
        },
      },
      actions: {
        listRepoWorkflows: async ({ owner, repo, per_page, page }) => ({
          data: lookup("actions.listRepoWorkflows", {
            owner,
            repo,
            per_page,
            page,
          }) as GithubWorkflow[],
        }),
        // Ground truth lives in `dispatched`, already reconciled at record
        // time; nothing offline re-reads the runs API.
        listWorkflowRunsForRepo: async () => {
          throw new Error("workflow runs are not replayable");
        },
        listJobsForWorkflowRun: async () => {
          throw new Error("run jobs are not replayable");
        },
      },
    },
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
  return { client, misses };
}

/** A `JobExecutor` that answers only from the capture. Misses are collected, as above. */
export function replayExecutor(capture: E2ECapture): {
  executor: JobExecutor;
  misses: string[];
} {
  const byKey = new Map(capture.recording.exec.map((r) => [r.key, r]));
  const misses: string[] = [];
  return {
    executor: {
      executeJob: async (jobId, job, wf, scope) => {
        const key = execKey(jobId, job, wf, scope);
        const rec = byKey.get(key);
        if (rec === undefined) {
          misses.push(`${jobId} ${key}`);
          return { ok: false, reason: `capture miss: execution of '${jobId}'` };
        }
        return rec.outcome;
      },
    },
    misses,
  };
}
