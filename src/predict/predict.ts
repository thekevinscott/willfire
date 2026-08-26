// Predict the set of CI check entries GitHub Actions will create for a PR.
//
// Faithful port of predict.py, which was verified entry-for-entry against
// live dispatches on thekevinbot/willrun-probe (PRs 1-7). Check-name
// resolution was verified the same way on probe PR 8, and cross-repo reusable
// workflow calls on probe PR 9; the rules they turned up are pinned in
// src/names.test.ts.

import type { Octokit } from "@octokit/rest";
import type { Scope } from "../expr/val.js";
import { finalizePrediction } from "./finalizePrediction.js";
import { makeLiveExecutor } from "./makeLiveExecutor.js";
import { makeReader } from "./makeReader.js";
import { hasSkipInstruction } from "./skipInstruction.js";
import { sourceKey } from "./sourceKey.js";
import { stackTargetRef } from "./stackTargetRef.js";
import { workflowEntries } from "./workflowEntries.js";
import type {
  Ctx,
  DraftEntry,
  Prediction,
  PredictOptions,
  WorkflowSource,
} from "../types.js";

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
    ...(stackTarget != null ? { stackTarget } : {}),
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

  if (hasSkipInstruction(headCommit.commit.message)) {
    return finalizePrediction(
      [],
      "head commit message contains a skip instruction",
      sources,
    );
  }

  const reader = makeReader(octokit, sources);

  // Execution is on by default and costs nothing until a workflow needs it.
  const executor =
    opts.executor === undefined
      ? makeLiveExecutor(octokit, headSource, reader.resolveRef)
      : (opts.executor ?? undefined);

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
    if (!w.path.startsWith(".github/workflows/")) {
      continue;
    }
    entries.push(...(await workflowEntries(w, ctx, reader, headSource, prFacts, executor)));
  }
  return finalizePrediction(entries, null, sources);
}
