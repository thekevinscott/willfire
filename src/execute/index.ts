/**
 * Execute a job the caller granted, to learn what static reading cannot.
 *
 * A dynamic matrix — `language: ${{ fromJSON(needs.detect.outputs.x) }}` — is
 * the values another job computes at runtime. No amount of reading the YAML
 * yields them; the fleet's `detect` job runs a script over the repo tree and
 * writes what it finds to `$GITHUB_OUTPUT`. So this module runs that job the
 * way the runner would: materialize the tree at the pinned commit, walk the
 * steps in order, execute each `run:` under its declared shell and env, and
 * assemble the job's `outputs:` map from what the steps actually wrote.
 *
 * Three rules keep this honest:
 *
 * 1. **Nothing runs without a grant.** willfire has no opinion about which
 *    jobs are safe to execute; the caller names them, one repo and job id at
 *    a time, and everything else stays as unresolved as it was.
 * 2. **Run it, never interpret it.** The `run:` script is handed to the shell
 *    the step declares, with the env it declares. What lands in
 *    `$GITHUB_OUTPUT` is the answer; no shell text is ever parsed for meaning.
 * 3. **Anything off the modelled path is a hard stop with a reason.** A
 *    JavaScript action, an undecidable `if:`, a `${{ }}` that will not
 *    resolve, a step that exits non-zero — each fails the execution and says
 *    what it hit, and the consumers of that job's outputs stay unresolved.
 *    Guessing is the one move this module never makes.
 *
 * `actions/checkout` is the deliberate exception to rule 2. It is provided by
 * the runner, not run from its repo, and its whole postcondition — the
 * workspace tree at the commit under test — is something the executor has
 * already satisfied by materializing the tree. A bare checkout is therefore
 * recorded as done; a checkout *with inputs* is not modelled and stops.
 */
export { makeExecutor } from "./makeExecutor.js";
export { makeTreeProvider } from "./makeTreeProvider.js";
export { parseGithubOutput } from "./parseGithubOutput.js";
export { parseGrant } from "./parseGrant.js";
export { runShell } from "./runShell.js";
export type {
  ExecDeps,
  ExecOutcome,
  ExecutionGrant,
  JobExecutor,
  ProvideTree,
  RunCommand,
  RunResult,
  RunSpec,
} from "./types.js";
