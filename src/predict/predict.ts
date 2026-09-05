// Predict the set of CI check entries GitHub Actions will create for a PR.
//
// Faithful port of predict.py, which was verified entry-for-entry against
// live dispatches on thekevinbot/willrun-probe (PRs 1-7). Check-name
// resolution was verified the same way on probe PR 8, and cross-repo reusable
// workflow calls on probe PR 9; the rules they turned up are pinned in
// src/names.test.ts.

import { parse as parseYaml } from "yaml";
import { resolveCallbackMap } from "../callback/resolveCallbackMap.js";
import { jobName } from "../entries/jobName.js";
import type { Scope } from "../expr/val.js";
import { expandJobs } from "../jobs/expandJobs.js";
import { workflowDispatches } from "../triggers/workflowDispatches.js";
import { finalizePrediction } from "./finalizePrediction.js";
import type { GithubClient } from "./makeGithubClient.js";
import { makeLiveExecutor } from "./makeLiveExecutor.js";
import { sourceKey } from "./sourceKey.js";
import { stackTargetRef } from "./stackTargetRef.js";
import type {
  Ctx,
  DraftEntry,
  FetchWorkflow,
  Prediction,
  PredictOptions,
  ResolveRef,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

const SKIP_RE = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i;
const SKIP_TRAILER_RE = /^skip-checks:\s*true/im;

export async function predict(
  github: GithubClient,
  repo: string,
  prNumber: number,
  opts: PredictOptions = {},
): Promise<Prediction> {
  const [owner, name] = repo.split("/");
  const base = { owner, repo: name };

  const pr = await github.getPull({ ...base, pull_number: prNumber });
  const files = await github.listPullFiles({ ...base, pull_number: prNumber });
  const stackTarget = await stackTargetRef(github, owner, name, pr);
  const ctx: Ctx = {
    // The caller's answer wins whenever it has one. The commit-count fallback
    // is a guess kept only so existing callers keep working.
    action: opts.action ?? (pr.commits > 1 ? "synchronize" : "opened"),
    baseRef: pr.base.ref,
    ...(stackTarget !== null ? { stackTarget } : {}),
    files: files.map((f) => f.filename),
  };
  const headSha = pr.head.sha;

  /**
   * The PR's own repo at the head commit — the surface the skip instruction is
   * read from, and already a commit id, so its `ref` and `sha` are the same
   * string.
   */
  const headSource: WorkflowSource = { owner, repo: name, ref: headSha, sha: headSha };

  /**
   * GitHub evaluates a `pull_request` at the test merge, not the head (#105).
   * Null when it has none: a conflict, or a merge not computed yet.
   */
  const mergeSha = pr.merge_commit_sha;
  const readSource: WorkflowSource =
    mergeSha === null ? headSource : { owner, repo: name, ref: mergeSha, sha: mergeSha };

  const readLabel = readSource.sha === headSha ? "head" : "the test merge commit";

  // Provenance for the answer, filled as expansion reaches each source. The head
  // is in from the start: it is read even on the skip path, where the commit
  // message is what decides the verdict.
  const sources = new Map<string, WorkflowSource>([[sourceKey(headSource), headSource]]);

  const headCommit = await github.getCommit({ ...base, ref: headSha });
  const headMsg = headCommit.commit.message;

  if (SKIP_RE.test(headMsg) || SKIP_TRAILER_RE.test(headMsg)) {
    return finalizePrediction(
      [],
      "head commit message contains a skip instruction",
      sources,
    );
  }

  sources.set(sourceKey(readSource), readSource);

  // A `uses:` naming a tag is the same lookup from every caller that writes it,
  // so resolve each `owner/repo@ref` once. Misses are cached too: a ref that
  // cannot be resolved will not start resolving on the second ask.
  const refCache = new Map<string, string | null>();
  const resolveRef: ResolveRef = async (src) => {
    const key = sourceKey(src);
    const hit = refCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let sha: string | null;
    try {
      const commit = await github.getCommit({
        owner: src.owner,
        repo: src.repo,
        ref: src.ref,
      });
      sha = commit.sha;
    } catch {
      // Deleted tag, private repo, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      sha = null;
    }
    refCache.set(key, sha);
    if (sha !== null) {
      sources.set(key, { ...src, sha });
    }
    return sha;
  };

  // One callee is commonly reached from several callers — a fleet repo calls
  // the same `testing-conventions@v0` from eight workflows — so remember what
  // each `owner/repo/path@sha` resolved to, misses included.
  const cache = new Map<string, string | null>();
  const fetchWorkflow: FetchWorkflow = async (path, src) => {
    // Keyed and fetched on the commit, never the ref that named it. Two callers
    // writing `@v0` and `@abc123` for the same commit are one read, and a tag
    // that moves mid-prediction cannot hand back two different files.
    const key = `${src.owner}/${src.repo}/${path}@${src.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    let content: string | null;
    try {
      content = await github.getContent({
        owner: src.owner,
        repo: src.repo,
        path,
        ref: src.sha,
      });
    } catch {
      // Private, deleted, bad ref, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      content = null;
    }
    cache.set(key, content);
    return content;
  };

  const reader: WorkflowReader = { fetchWorkflow, resolveRef };

  // Execution is on by default and costs nothing until a workflow needs it.
  const executor =
    opts.executor === undefined
      ? makeLiveExecutor(github, readSource, resolveRef)
      : (opts.executor ?? undefined);

  // Callbacks run once, before any workflow is expanded, so every invocation
  // consults the same map. A failing callback throws and aborts the prediction.
  const callbackMap = await resolveCallbackMap(opts.callbacks ?? []);

  const workflows = await github.listWorkflows(base);

  // `github.repository` is fixed for everything predicted here: reusable
  // workflows and composite actions all run in the repo the PR is against.
  // Seeding it once makes guards like the fleet's hermetic-vs-published
  // `github.repository ==` checks decidable everywhere, granted or not.
  const prFacts: Scope = {
    github: { repository: `${headSource.owner}/${headSource.repo}` },
  };

  const workflowEntries = async (path: string, state: string): Promise<DraftEntry[]> => {
    if (state !== "active") {
      return [
        { workflow: path, job: "*", status: "no-dispatch", reason: `workflow state: ${state}` },
      ];
    }
    const content = await fetchWorkflow(path, readSource);
    if (content === null) {
      // The Actions API keeps listing a workflow as `active` after its file is
      // deleted. There is no file to evaluate, so there is nothing to dispatch —
      // the same verdict as the disabled case above, reached a different way.
      return [
        {
          workflow: path,
          job: "*",
          status: "no-dispatch",
          reason: `no workflow file at ${readLabel}`,
        },
      ];
    }
    let wf: Workflow;
    try {
      wf = parseYaml(content);
    } catch (e) {
      // GitHub creates a run for an unparseable workflow file and concludes it
      // `startup_failure`. The run exists but has no jobs, so this is a
      // workflow-level "it dispatches" with nothing to expand.
      return [{ workflow: path, job: "*", status: "run", reason: `YAML parse error: ${e}` }];
    }
    const [dispatches, reason] = workflowDispatches(wf, ctx);
    if (!dispatches) {
      return [{ workflow: path, job: "*", status: "no-dispatch", reason }];
    }
    const jobs = await expandJobs(
      wf,
      ctx,
      reader,
      { path, source: readSource },
      0,
      "",
      true,
      prFacts,
      executor,
      callbackMap,
    );
    return jobs.map((j) => ({
      workflow: path,
      job: jobName(j.job),
      checkName: j.checkName,
      status: j.status,
      reason: j.reason || reason,
    }));
  };

  const entries: DraftEntry[] = [];
  for (const w of workflows) {
    if (w.path.startsWith(".github/workflows/")) {
      entries.push(...(await workflowEntries(w.path, w.state)));
    }
  }
  return finalizePrediction(entries, null, sources);
}
