// Predict the set of CI check entries GitHub Actions will create for a PR.
//
// Faithful port of predict.py, which was verified entry-for-entry against
// live dispatches on thekevinbot/willrun-probe (PRs 1-7). Check-name
// resolution was verified the same way on probe PR 8, and cross-repo reusable
// workflow calls on probe PR 9; the rules they turned up are pinned in
// src/names.test.ts.

import type { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import { jobName } from "../entries/jobName.js";
import { makeExecutor, makeTreeProvider, runShell, type JobExecutor } from "../execute.js";
import type { Scope } from "../expr/val.js";
import { expandJobs } from "../jobs/expandJobs.js";
import { workflowDispatches } from "../triggers/workflowDispatches.js";
import { finalizePrediction } from "./finalizePrediction.js";
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
  octokit: Octokit,
  repo: string,
  prNumber: number,
  opts: PredictOptions = {},
): Promise<Prediction> {
  const [owner, name] = repo.split("/");
  const base = { owner, repo: name };

  const { data: pr } = await octokit.rest.pulls.get({ ...base, pull_number: prNumber });
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...base,
    pull_number: prNumber,
    per_page: 100,
  });
  const stackTarget = await stackTargetRef(octokit, owner, name, pr);
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
   * The PR's own repo at the head commit — where expansion starts, and already
   * a commit id, so its `ref` and `sha` are the same string.
   */
  const headSource: WorkflowSource = { owner, repo: name, ref: headSha, sha: headSha };

  // Provenance for the answer, filled as expansion reaches each source. The head
  // is in from the start: it is read even on the skip path, where the commit
  // message is what decides the verdict.
  const sources = new Map<string, WorkflowSource>([[sourceKey(headSource), headSource]]);

  const { data: headCommit } = await octokit.rest.repos.getCommit({
    ...base,
    ref: headSha,
  });
  const headMsg = headCommit.commit.message;

  if (SKIP_RE.test(headMsg) || SKIP_TRAILER_RE.test(headMsg)) {
    return finalizePrediction(
      [],
      "head commit message contains a skip instruction",
      sources,
    );
  }

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
      const { data } = await octokit.rest.repos.getCommit({
        owner: src.owner,
        repo: src.repo,
        ref: src.ref,
      });
      sha = data.sha;
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
      const { data } = await octokit.rest.repos.getContent({
        owner: src.owner,
        repo: src.repo,
        path,
        ref: src.sha,
        mediaType: { format: "raw" },
      });
      content = data as unknown as string;
    } catch {
      // Private, deleted, bad ref, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      content = null;
    }
    cache.set(key, content);
    return content;
  };

  const reader: WorkflowReader = { fetchWorkflow, resolveRef };

  // The executor exists only when the caller granted something. Trees come
  // from the tarball endpoint at the resolved commit, and every subprocess —
  // `tar` included — goes through the one `runShell` seam.
  let executor: JobExecutor | undefined;
  if (opts.execute !== undefined && opts.execute.length > 0) {
    const download = async (src: WorkflowSource): Promise<Uint8Array | null> => {
      try {
        const { data } = await octokit.rest.repos.downloadTarballArchive({
          owner: src.owner,
          repo: src.repo,
          ref: src.sha,
        });
        return new Uint8Array(data as ArrayBuffer);
      } catch {
        // Private, deleted, rate limit, network: one answer, and the entries
        // behind it stay unresolved with the failure named.
        return null;
      }
    };
    executor = makeExecutor({
      grants: opts.execute,
      workspace: headSource,
      deps: {
        provideTree: makeTreeProvider(download, runShell),
        runCommand: runShell,
        resolveRef,
      },
    });
  }

  const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
    ...base,
    per_page: 100,
  });

  // `github.repository` is fixed for everything predicted here: reusable
  // workflows and composite actions all run in the repo the PR is against.
  // Seeding it once makes guards like the fleet's hermetic-vs-published
  // `github.repository ==` checks decidable everywhere, granted or not.
  const prFacts: Scope = {
    github: { repository: `${headSource.owner}/${headSource.repo}` },
  };

  const entries: DraftEntry[] = [];
  for (const w of workflows) {
    const path = w.path;
    if (path.startsWith(".github/workflows/")) {
      if (w.state !== "active") {
        entries.push({
          workflow: path,
          job: "*",
          status: "no-dispatch",
          reason: `workflow state: ${w.state}`,
        });
      } else {
        const content = await fetchWorkflow(path, headSource);
        if (content === null) {
          // The Actions API keeps listing a workflow as `active` after its file is
          // deleted. There is no file at head, so there is nothing to dispatch —
          // the same verdict as the disabled case above, reached a different way.
          entries.push({
            workflow: path,
            job: "*",
            status: "no-dispatch",
            reason: "no workflow file at head",
          });
        } else {
          let wf: Workflow | undefined;
          try {
            wf = parseYaml(content);
          } catch (e) {
            // GitHub creates a run for an unparseable workflow file and concludes it
            // `startup_failure`. The run exists but has no jobs, so this is a
            // workflow-level "it dispatches" with nothing to expand.
            entries.push({
              workflow: path,
              job: "*",
              status: "run",
              reason: `YAML parse error: ${e}`,
            });
          }
          if (wf !== undefined) {
            const [dispatches, reason] = workflowDispatches(wf, ctx);
            if (!dispatches) {
              entries.push({ workflow: path, job: "*", status: "no-dispatch", reason });
            } else {
              for (const j of await expandJobs(
                wf,
                ctx,
                reader,
                headSource,
                0,
                "",
                true,
                prFacts,
                executor,
              )) {
                entries.push({
                  workflow: path,
                  job: jobName(j.job),
                  checkName: j.checkName,
                  status: j.status,
                  reason: j.reason || reason,
                });
              }
            }
          }
        }
      }
    }
  }
  return finalizePrediction(entries, null, sources);
}
