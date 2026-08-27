import type { ExecutionGrant } from "./execute/types.js";

export interface EntryBase {
  workflow: string;
  reason: string;
}

export type JobName = string & { readonly __jobName: true };

export interface WorkflowEntry extends EntryBase {
  job: "*";
  checkName: null;
  status: "run" | "skipped" | "no-dispatch";
}

export interface JobEntry extends EntryBase {
  job: JobName;
  checkName: string | null;
  status: "run" | "skipped" | "unknown";
}

export type Entry = WorkflowEntry | JobEntry;

export interface Prediction {
  entries: Entry[];
  checkNames: string[];
  skip: string | null;
  sources: WorkflowSource[];
}

export type DraftWorkflowEntry = Omit<WorkflowEntry, "checkName">;
export type DraftJobEntry = Omit<JobEntry, "checkName"> & { checkName?: string | null };
export type DraftEntry = DraftWorkflowEntry | DraftJobEntry;

export type PrEventAction = "opened" | "synchronize" | "reopened";

export interface PredictOptions {
  action?: PrEventAction;
  execute?: ExecutionGrant[];
}

export interface Ctx {
  action: string;
  baseRef: string;
  stackTarget?: string;
  files: string[];
}

export type Workflow = Record<string, any>;

export type Combo = Record<string, any> | null;

export interface DetailedCombo {
  values: Record<string, any>;
  displayKeys: string[];
}

export type DetailedCombos = Array<DetailedCombo | null> | null;

export interface Rendered {
  text: string;
  resolved: boolean;
}

export interface DisplayName {
  name: string;
  resolved: boolean;
}

export interface ExpandedJob {
  job: string;
  checkName: string | null;
  status: "run" | "skipped" | "unknown";
  reason: string;
}

export interface SourceRef {
  owner: string;
  repo: string;
  ref: string;
}

export interface WorkflowSource extends SourceRef {
  sha: string;
}

export type FetchWorkflow = (
  path: string,
  source: WorkflowSource,
) => Promise<string | null>;

export type ResolveRef = (source: SourceRef) => Promise<string | null>;

export interface WorkflowReader {
  fetchWorkflow: FetchWorkflow;
  resolveRef: ResolveRef;
}

export interface UsesTarget {
  path: string;
  source: SourceRef | null;
}

export interface StackNode {
  base: { ref: string };
  merge_commit_sha: string | null;
}
