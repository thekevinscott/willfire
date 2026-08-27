import type { Scope } from "../expr/val.js";
import type { ResolveRef, SourceRef, WorkflowSource } from "../types.js";

export interface ExecutionGrant {
  repo: string;
  jobs: string[];
}

export interface RunSpec {
  script: string;
  shell: "bash" | "sh";
  cwd: string;
  env: Record<string, string>;
}

export interface RunResult {
  code: number;
  stderr: string;
}

export type RunCommand = (spec: RunSpec) => Promise<RunResult>;

export type ProvideTree = (source: WorkflowSource) => Promise<string | null>;

export interface ExecDeps {
  provideTree: ProvideTree;
  runCommand: RunCommand;
  resolveRef: ResolveRef;
}

export type ExecOutcome =
  | { ok: true; outputs: Record<string, string> }
  | { ok: false; reason: string };

export interface JobExecutor {
  granted(source: WorkflowSource, jobId: string): boolean;
  executeJob(jobId: string, job: any, wf: any, scope: Scope): Promise<ExecOutcome>;
}

export type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

export interface WalkCtx {
  tree: string;
  actionPath?: string;
  envLayers: unknown[];
  deps: ExecDeps;
  depth: number;
}

export interface ActionTarget {
  path: string;
  source: SourceRef;
}
