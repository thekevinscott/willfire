import type { Scope } from "../expr.js";
import type { WorkflowSource } from "../types.js";
import { renderTemplate } from "./renderTemplate.js";
import { runSteps } from "./runSteps.js";
import type { ExecDeps, ExecOutcome, JobExecutor } from "./types.js";
import { CHECKOUT_RE } from "./walkCtx.js";

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
      if (job.strategy != null) return fail(`job '${jobId}' has a strategy; not modelled`);
      if (job.container != null || job.services != null) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) return fail(`job '${jobId}' has no steps`);
      // Any checkout input might be the `fetch-depth: 0` form. Over-asking for
      // one the walk will refuse anyway costs a clone, never correctness.
      const needsHistory = job.steps.some(
        (s: any) =>
          s != null &&
          typeof s.uses === "string" &&
          CHECKOUT_RE.test(s.uses) &&
          s.with != null &&
          Object.keys(s.with).length > 0,
      );
      const tree = await deps.provideTree(workspace, { history: needsHistory });
      if (tree == null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(job.steps, jobScope, {
        tree,
        hasHistory: needsHistory,
        envLayers: [wf?.env, job.env],
        deps,
        depth: 0,
      });
      if (!walked.ok) return fail(walked.reason);
      // Every declared output must land; a partial map would be a lie.
      const outScope: Scope = { ...jobScope, steps: walked.v };
      const outputs: Record<string, string> = {};
      for (const [name, raw] of Object.entries(job.outputs ?? {})) {
        const rendered = renderTemplate(String(raw), outScope);
        if (rendered == null) return fail(`cannot resolve job output '${name}'`);
        outputs[name] = rendered;
      }
      return { ok: true, outputs };
    },
  };
}
