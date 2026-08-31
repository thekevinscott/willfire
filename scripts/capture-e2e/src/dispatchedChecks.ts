import type { GithubClient } from "willfire";
import type { DispatchedCheck } from "../../../tests/fixtures/pinned/capture.js";

/**
 * Ground truth for one dispatch: every check GitHub created at `headSha`,
 * skipped ones included. `incomplete` names the workflows still in flight —
 * an unfinished dispatch is not ground truth yet.
 */
export async function dispatchedChecks(
  github: GithubClient,
  owner: string,
  repo: string,
  headSha: string,
): Promise<{ checks: DispatchedCheck[]; incomplete: string[] }> {
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    owner,
    repo,
    head_sha: headSha,
    event: "pull_request",
    per_page: 100,
  });
  const checks: DispatchedCheck[] = [];
  const incomplete: string[] = [];
  for (const run of runs) {
    if (run.status !== "completed") {
      incomplete.push(run.path);
    }
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      owner,
      repo,
      run_id: run.id,
      per_page: 100,
    });
    for (const job of jobs) {
      checks.push({ workflow: run.path, name: job.name, conclusion: job.conclusion });
    }
  }
  return { checks, incomplete };
}
