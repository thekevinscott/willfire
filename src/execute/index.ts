/**
 * Execute a job whose outputs another job reads, the way the runner would:
 * materialize the tree, walk the steps, read what they wrote to
 * `$GITHUB_OUTPUT`. Two invariants: run it, never interpret it (no shell text
 * is parsed for meaning), and anything off the modelled path is a hard stop
 * with a reason — never a guess.
 */

export { makeCloneProvider } from "./makeCloneProvider.js";
export { makeExecutor } from "./makeExecutor.js";
export { makeTreeProvider } from "./makeTreeProvider.js";
export { parseGithubOutput } from "./parseGithubOutput.js";
export { renderTemplate } from "./renderTemplate.js";
export { runShell } from "./runShell.js";
export type {
  ExecDeps,
  ExecOutcome,
  JobExecutor,
  Mount,
  ProvideTree,
  RunCommand,
  RunResult,
  RunSpec,
} from "./types.js";
