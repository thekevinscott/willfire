import type { Octokit } from "@octokit/rest";
import type { Scope } from "../expr/val.js";
import { expandWorkflow } from "./expandWorkflow.js";
import { finalizePrediction } from "./finalizePrediction.js";
import { grantedExecutor } from "./grantedExecutor.js";
import { makeFetchWorkflow } from "./makeFetchWorkflow.js";
import { makeResolveRef } from "./makeResolveRef.js";
import { sourceKey } from "./sourceKey.js";
import { stackTargetRef } from "./stackTargetRef.js";
import type {
  Ctx,
  DraftEntry,
  Prediction,
  PredictOptions,
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
    action: opts.action ?? (pr.commits > 1 ? "synchronize" : "opened"),
    baseRef: pr.base.ref,
    ...(stackTarget != null ? { stackTarget } : {}),
    files: files.map((f) => f.filename),
  };
  const headSha = pr.head.sha;
  const headSource: WorkflowSource = { owner, repo: name, ref: headSha, sha: headSha };
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

  const resolveRef = makeResolveRef(octokit, sources);
  const reader: WorkflowReader = { fetchWorkflow: makeFetchWorkflow(octokit), resolveRef };
  const executor = grantedExecutor(octokit, headSource, resolveRef, opts.execute);

  const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
    ...base,
    per_page: 100,
  });

  const prFacts: Scope = {
    github: { repository: `${headSource.owner}/${headSource.repo}` },
  };

  const entries: DraftEntry[] = [];
  for (const w of workflows) {
    entries.push(...(await expandWorkflow(w, ctx, reader, headSource, prFacts, executor)));
  }
  return finalizePrediction(entries, null, sources);
}
