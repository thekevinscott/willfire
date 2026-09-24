import type { GithubClient } from "../../src/index.js";

/**
 * Every check GitHub actually created at `headSha`, skipped ones included.
 * Read live — this is the half of an e2e test that willfire does not compute.
 */
export async function dispatchedNames(
  github: Pick<GithubClient, "listWorkflowRuns" | "listRunJobs">,
  owner: string,
  repo: string,
  headSha: string,
): Promise<string[]> {
  const runs = await github.listWorkflowRuns({
    owner,
    repo,
    head_sha: headSha,
    event: "pull_request",
  });
  const names = new Set<string>();
  for (const run of runs) {
    const jobs = await github.listRunJobs({ owner, repo, run_id: run.id });
    for (const job of jobs) {
      names.add(job.name);
    }
  }
  return [...names].sort();
}
