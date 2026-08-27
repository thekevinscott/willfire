import type { Scope } from "../expr/val.js";
import type { WorkflowSource } from "../types.js";
import { renderTemplate } from "./renderTemplate.js";
import { runSteps } from "./runSteps.js";
import type { ExecDeps, ExecOutcome, ExecutionGrant, JobExecutor } from "./types.js";

export function makeExecutor(opts: {
  grants: ExecutionGrant[];
  workspace: WorkflowSource;
  deps: ExecDeps;
}): JobExecutor {
  const { grants, workspace, deps } = opts;
  const github: Record<string, string> = {
    event_name: "pull_request",
    repository: `${workspace.owner}/${workspace.repo}`,
  };
  const fail = (reason: string): ExecOutcome => ({ ok: false, reason });
  return {
    granted: (source, jobId) =>
      grants.some(
        (g) => g.repo === `${source.owner}/${source.repo}` && g.jobs.includes(jobId),
      ),
    async executeJob(jobId, job, wf, scope) {
      if (job.strategy != null) {
        return fail(`job '${jobId}' has a strategy; not modelled`);
      }
      if (job.container != null || job.services != null) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) {
        return fail(`job '${jobId}' has no steps`);
      }
      const tree = await deps.provideTree(workspace);
      if (tree == null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(job.steps, jobScope, {
        tree,
        envLayers: [wf?.env, job.env],
        deps,
        depth: 0,
      });
      if (!walked.ok) {
        return fail(walked.reason);
      }
      const outScope: Scope = { ...jobScope, steps: walked.v };
      const outputs: Record<string, string> = {};
      for (const [name, raw] of Object.entries(job.outputs ?? {})) {
        const rendered = renderTemplate(String(raw), outScope);
        if (rendered == null) {
          return fail(`cannot resolve job output '${name}'`);
        }
        outputs[name] = rendered;
      }
      return { ok: true, outputs };
    },
  };
}
