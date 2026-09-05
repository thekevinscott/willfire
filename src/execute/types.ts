import type { Scope } from "../expr/val.js";
import type { ResolveRef, Workflow, WorkflowSource } from "../types.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";

/** A host path a sandboxed runner must expose inside, at the same path. */
export interface Mount {
  path: string;
  writable: boolean;
}

/** One shell invocation, fully specified — nothing is inherited implicitly. */
export interface RunSpec {
  script: string;
  shell: "bash" | "sh";
  cwd: string;
  env: Record<string, string>;
  /** For runners that isolate: what of the host this run may see. A direct
   * shell ignores this — it already sees everything. */
  mounts?: Mount[];
}

export interface RunResult {
  code: number;
  stderr: string;
}

export type RunCommand = (spec: RunSpec) => Promise<RunResult>;

/**
 * Materialize a repo tree at a commit, or null when it cannot be had. Must not
 * throw. `history: true` demands full git history (the `fetch-depth: 0`
 * postcondition); a provider that cannot supply it answers null.
 */
export type ProvideTree = (
  source: WorkflowSource,
  opts?: { history?: boolean },
) => Promise<string | null>;

export interface ExecDeps {
  provideTree: ProvideTree;
  runCommand: RunCommand;
  resolveRef: ResolveRef;
  /** The node major `runCommand`'s world provides; asking for another is refused. */
  nodeMajor: number;
}

export type ExecOutcome =
  | { ok: true; outputs: Record<string, string> }
  | { ok: false; reason: string };

/**
 * The caller decides *whether* a job runs; the executor only decides what
 * running it yields.
 */
export interface JobExecutor {
  executeJob(jobId: string, job: Workflow, wf: Workflow, scope: Scope): Promise<ExecOutcome>;
}

/** The step walk's internal result: a value, or the reason there is none. */
export type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

/** The step keys the walker reads. Values stay YAML-shaped until a runtime
 * guard narrows them. */
export interface StepModel {
  id?: YamlValue;
  name?: YamlValue;
  if?: YamlValue;
  uses?: YamlValue;
  run?: YamlValue;
  shell?: YamlValue;
  with?: YamlMap | null;
  env?: YamlValue;
  "working-directory"?: YamlValue;
}

export interface ActionModel {
  inputs?: YamlMap | null;
  outputs?: YamlMap | null;
  runs?: { using?: YamlValue; pre?: YamlValue; main?: YamlValue; steps?: StepModel[] | null } | null;
}

export interface WalkCtx {
  /** Workspace root: the PR head tree, where every step runs by default. */
  tree: string;
  /** Whether that tree carries its full git history (a clone, not a tarball). */
  hasHistory: boolean;
  /** Set inside a composite action — where `$GITHUB_ACTION_PATH` points. */
  actionPath?: string;
  /**
   * The whole materialized repo a remote action came from. A real runner
   * checks out the action's repo, not its `uses:` subdirectory, and actions do
   * reach past their own dir — so this, not `actionPath`, is the mount unit.
   */
  actionRoot?: string;
  /** Raw `env:` blocks from enclosing scopes, outermost first. */
  envLayers: (YamlValue | undefined)[];
  deps: ExecDeps;
  depth: number;
}
