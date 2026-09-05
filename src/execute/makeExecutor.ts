/**
 * Execute a job whose outputs another job reads, the way the runner would:
 * materialize the tree, walk the steps, read what they wrote to
 * `$GITHUB_OUTPUT`. Two invariants: run it, never interpret it (no shell text
 * is parsed for meaning), and anything off the modelled path is a hard stop
 * with a reason — never a guess.
 */

import type { Scope } from "../expr/val.js";
import type { WorkflowSource } from "../types.js";
import { isCheckout } from "./isCheckout.js";
import { renderTemplate } from "./renderTemplate.js";
import { runSteps } from "./runSteps.js";
import type { ExecDeps, ExecOutcome, JobExecutor, StepModel } from "./types.js";

export function makeExecutor(opts: {
  /**
   * The PR's own repo at the head commit. A reusable workflow's jobs run in
   * the caller's workspace, wherever the workflow file lives.
   */
  workspace: WorkflowSource;
  deps: ExecDeps;
}): JobExecutor {
  const { workspace, deps } = opts;
  const github: Record<string, string> = {
    event_name: "pull_request",
    repository: `${workspace.owner}/${workspace.repo}`,
  };
  const fail = (reason: string): ExecOutcome => ({ ok: false, reason });
  return {
    async executeJob(jobId, job, wf, scope) {
      if (job.strategy !== undefined && job.strategy !== null) {
        return fail(`job '${jobId}' has a strategy; not modelled`);
      }
      if (job.container !== null && job.container !== undefined) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (job.services !== null && job.services !== undefined) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) {
        return fail(`job '${jobId}' has no steps`);
      }
      const steps = job.steps as StepModel[];
      // Any checkout input might be the `fetch-depth: 0` form. Over-asking for
      // one the walk will refuse anyway costs a clone, never correctness.
      const needsHistory = steps.some(
        (s) =>
          s !== null &&
          s !== undefined &&
          typeof s.uses === "string" &&
          isCheckout(s.uses) &&
          Object.keys(s.with ?? {}).length > 0,
      );
      const tree = await deps.provideTree(workspace, { history: needsHistory });
      if (tree === null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(steps, jobScope, {
        tree,
        hasHistory: needsHistory,
        envLayers: [wf?.env, job.env],
        deps,
        depth: 0,
      });
      if (!walked.ok) {
        return fail(walked.reason);
      }
      // Every declared output must land; a partial map would be a lie.
      const outScope: Scope = { ...jobScope, steps: walked.v };
      const outputs: Record<string, string> = {};
      for (const [name, raw] of Object.entries(job.outputs ?? {})) {
        const rendered = renderTemplate(String(raw), outScope);
        if (rendered === null) {
          return fail(`cannot resolve job output '${name}'`);
        }
        outputs[name] = rendered;
      }
      return { ok: true, outputs };
    },
  };
}
