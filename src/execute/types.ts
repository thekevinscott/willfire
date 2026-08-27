import type { Scope } from "../expr/val.js";
import type { ResolveRef, SourceRef, WorkflowSource } from "../types.js";

/**
 * Permission to execute named jobs from one repo's workflows.
 *
 * `repo` is the repo the *workflow file* lives in — for a fleet consumer
 * calling `testing-conventions/.github/workflows/testing-conventions.yml@v0`,
 * that is `thekevinscott/testing-conventions`, whatever repo the PR is on.
 * The grant is deliberately this narrow: a job id alone would execute
 * whatever any transitively-reached workflow happens to call by that name.
 */
export interface ExecutionGrant {
  /** `owner/name` of the repo whose workflow defines the jobs. */
  repo: string;
  /** Job ids within that repo's workflows that may be executed. */
  jobs: string[];
}

/** One shell invocation, fully specified — nothing is inherited implicitly. */
export interface RunSpec {
  script: string;
  shell: "bash" | "sh";
  cwd: string;
  env: Record<string, string>;
}

export interface RunResult {
  code: number;
  /** Captured so a failing step can say *why* in its reason. */
  stderr: string;
}

export type RunCommand = (spec: RunSpec) => Promise<RunResult>;

/**
 * Materialize a repo tree at a commit and return its root directory, or null
 * when it cannot be had. Must not throw.
 */
export type ProvideTree = (source: WorkflowSource) => Promise<string | null>;

/** The three reaches into the world an execution needs, bundled for injection. */
export interface ExecDeps {
  provideTree: ProvideTree;
  runCommand: RunCommand;
  resolveRef: ResolveRef;
}

export type ExecOutcome =
  | { ok: true; outputs: Record<string, string> }
  | { ok: false; reason: string };

/**
 * What expansion asks of an executor. The caller decides *whether* a job
 * runs with its own scope — the executor only decides what running it
 * yields. Step-level guards inside the job are evaluated here, against the
 * fixed facts of the run (notably `github.repository`, which the fleet's
 * hermetic-vs-published guards are written against).
 */
export interface JobExecutor {
  granted(source: WorkflowSource, jobId: string): boolean;
  executeJob(jobId: string, job: any, wf: any, scope: Scope): Promise<ExecOutcome>;
}

/** Internal result: a value or the reason there is none. */
export type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

/** What one step walk carries besides the expression scope. */
export interface WalkCtx {
  /** Workspace root: the PR head tree, where every step runs by default. */
  tree: string;
  /** Set inside a composite action — where `$GITHUB_ACTION_PATH` points. */
  actionPath?: string;
  /** Raw `env:` blocks from enclosing scopes, outermost first. */
  envLayers: unknown[];
  deps: ExecDeps;
  depth: number;
}

/** A step-level `uses:` target: the action's path within its source repo. */
export interface ActionTarget {
  path: string;
  source: SourceRef;
}
