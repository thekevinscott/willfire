import type { JobExecutor } from "./execute.js";
import type { YamlMap } from "./yamlValue.js";

export interface EntryBase {
  workflow: string;
  reason: string;
}

/**
 * A job's display name, e.g. `test (18)`.
 *
 * Nominally distinct from `string` for one reason: `Entry` is a closed union
 * and `"*"` is the workflow-level sentinel, so a plain `string` here would
 * structurally admit `{ job: "*", status: "unknown" }` as a `JobEntry` — the
 * exact shape this split exists to forbid. TypeScript cannot spell "string
 * but not `"*"`", so the job side is branded instead. Build one with
 * `jobName`; reading one is just a string.
 */
export type JobName = string & { readonly __jobName: true };

/**
 * A verdict about the workflow as a whole: it produces no run at all, or it
 * produces a run that expands into no job entries.
 *
 * There is no `"unknown"` here, and that is the point. Every workflow-level
 * verdict is decidable, and this type is what enforces it — the previous
 * single-interface shape let `{ job: "*", status: "unknown" }` typecheck, which
 * is what shipped and what pr-monitor#17 had to grow a `tolerated` bucket for.
 */
export interface WorkflowEntry extends EntryBase {
  job: "*";
  /** Always null: a workflow-level verdict is about the run, not a named check. */
  checkName: null;
  status: "run" | "skipped" | "no-dispatch";
}

/**
 * A verdict about one job entry inside a workflow that does dispatch.
 *
 * These can be genuinely undecidable statically — dynamic matrix, a reusable
 * workflow we cannot read, unresolvable `if`, or `needs` on any of those — so
 * `"unknown"` lives here and only here.
 *
 * `"no-dispatch"` is the mirror image, and lives on {@link WorkflowEntry} and
 * only there. It is a verdict about whether the run happens at all, which is
 * settled before any job is looked at — so by the time there is a job entry to
 * label, the answer is already yes.
 */
export interface JobEntry extends EntryBase {
  job: JobName;
  /**
   * The check name GitHub will create for this entry, resolved the way the
   * Actions runner names jobs: `name:` override, matrix parenthetical, and
   * `<caller> / <callee>` prefixing for reusable workflows.
   *
   * null when there is no single statically-knowable name: a matrix computed
   * at runtime, a reusable workflow we could not fetch, or a `name:` that
   * interpolates something we cannot evaluate ahead of the run.
   */
  checkName: string | null;
  status: "run" | "skipped" | "unknown";
}

export type Entry = WorkflowEntry | JobEntry;

export interface Prediction {
  entries: Entry[];
  /**
   * Convenience aggregate: the sorted, deduplicated check names of every
   * entry with status "run" and a resolved name. Entries whose name could
   * not be resolved are absent here — read `entries` to see them.
   */
  checkNames: string[];
  skip: string | null; // set when a skip instruction suppresses everything
  /**
   * Every repo this prediction read, and the commit each ref resolved to —
   * the PR's own head first, then any cross-repo `uses:` reached from it.
   *
   * Provenance, not input. `v0` is a moving tag, so "willfire said these
   * checks" is only reconcilable against a run if it also says which commits
   * it read to say it. Sorted by `owner/repo@ref`.
   */
  sources: WorkflowSource[];
}

/**
 * Internal entry shapes. `checkName` is optional while entries are being
 * accumulated so that workflow-level pushes stay one-liners; `finalize`
 * settles the omitted ones to null.
 *
 * Deliberately a union of two Omits rather than `Omit<Entry, "checkName">`.
 * `Omit` over a union collapses to its common keys, which would re-widen
 * `job`/`status` back into the single flat shape that let
 * `{ job: "*", status: "unknown" }` typecheck. The push sites are exactly
 * where that has to stay illegal, so the draft type keeps the variants apart.
 */
export type DraftWorkflowEntry = Omit<WorkflowEntry, "checkName">;
export type DraftJobEntry = Omit<JobEntry, "checkName"> & { checkName?: string | null };
export type DraftEntry = DraftWorkflowEntry | DraftJobEntry;

/**
 * The `pull_request` actions a caller can name.
 *
 * Deliberately the three default types and no more. `pull_request` fires on
 * around twenty actions — `ready_for_review`, `edited`, `labeled` — and a
 * workflow that narrows `types:` to one of those is not predictable today
 * regardless of what is passed here. Widening this union later is a
 * non-breaking change; narrowing it would not be, so it starts narrow.
 */
export type PrEventAction = "opened" | "synchronize" | "reopened";

/** Options every caller may omit. */
export interface PredictOptions {
  /**
   * The literal event action the run was triggered by — `github.event.action`
   * inside an Action, or `--action` on the CLI.
   *
   * Omitting it falls back to inferring from the commit count, which is a
   * guess and is wrong in both directions: a PR opened from a branch with
   * several commits looks like `synchronize`, a force-push down to one commit
   * looks like `opened`, and `reopened` is never produced. That only matters
   * to a workflow narrowing `types:`, where it matters completely.
   */
  action?: PrEventAction;
  /**
   * The executor that resolves what reading cannot. Omitted, prediction
   * builds the live sandboxed one; `null` disables execution; passing a
   * {@link JobExecutor} is a test seam, not configuration.
   */
  executor?: JobExecutor | null;
  /**
   * Commands that answer needed-job outputs from a recording instead of
   * execution — one string per `--callback`, split on whitespace and spawned
   * directly, once per prediction. A callback failing, or two answering the
   * same key, aborts the prediction.
   */
  callbacks?: readonly string[];
}

export interface Ctx {
  action: string;
  baseRef: string;
  /**
   * The branch the PR's stack ultimately targets, set only when GitHub's
   * stacked-PR machinery is engaged (see `stackTargetRef`). Branch
   * filters match against this instead of `baseRef` (#30).
   */
  stackTarget?: string;
  files: string[];
}

export type Workflow = YamlMap;

export type Combo = YamlMap | null;

/**
 * A matrix combination plus the keys that appear in its check-name
 * parenthetical. The two differ: a key contributed by an `include` entry that
 * merged into an existing axis-product combination is readable as
 * `${{ matrix.key }}` but is NOT shown in the name.
 *
 * Probe-verified with `a: [x]` plus `include: [{a: x, extra: e1},
 * {a: z, extra: e2}]` -> checks `m-include2 (x)` and `m-include2 (z, e2)`.
 * The merged combination shows the axis key only; the combination the include
 * created from scratch shows all of its own keys.
 */
export interface DetailedCombo {
  values: YamlMap;
  displayKeys: string[];
}

/**
 * null element = no matrix at all (a single, unsuffixed job).
 *
 * An *empty* array is different, and different again from a null return: it
 * means the matrix is present and expanded to zero combinations, so the job
 * schedules nothing. `[null]` would claim one check under the bare job name,
 * which is a name GitHub never creates for a matrix job.
 */
export type DetailedCombos = Array<DetailedCombo | null> | null;

export interface Rendered {
  text: string;
  /** false when an expression was left in place because we cannot evaluate it. */
  resolved: boolean;
}

export interface DisplayName {
  name: string;
  resolved: boolean;
}

/**
 * One expanded job, before it is paired with its workflow. Named `ExpandedJob`
 * because `JobEntry` is now the exported job-level variant of `Entry`.
 */
export interface ExpandedJob {
  /** The job id this entry was built from. */
  job: string;
  /** The resolved check name, or null when it could not be settled statically. */
  checkName: string | null;
  status: "run" | "skipped" | "unknown";
  reason: string;
}

/**
 * Which repo and ref a workflow file is read from.
 *
 * Expansion carries one of these rather than a bare path because `uses:` can
 * cross repositories. A local `uses: ./...` keeps the current source, so a
 * relative call inside a workflow that was itself reached by
 * `owner/repo/path@ref` resolves against *that* repo at *that* ref — probe
 * verified, see `src/names.test.ts`.
 */
export interface SourceRef {
  owner: string;
  repo: string;
  /** Tag, branch, or SHA — whatever `@` was pinned to. */
  ref: string;
}

/**
 * A source whose ref has been resolved to the commit it names.
 *
 * Expansion walks these and never a bare {@link SourceRef}: `v0` is a moving
 * tag, so two reads an hour apart can be two different programs, and a
 * prediction that cannot name the commit it read cannot be reconciled against
 * the run afterwards. Making the SHA required is what stops an unresolved ref
 * being expanded against by accident.
 */
export interface WorkflowSource extends SourceRef {
  /** The commit `ref` names. Equal to `ref` when it was already a SHA. */
  sha: string;
}

/**
 * Where a job is defined: the workflow file's repo-relative path and the repo
 * and commit it was read from. Expansion threads one of these so a job can be
 * named by its definition site — `uses:` crosses repos, so the path alone is
 * not an identity.
 */
export interface JobSite {
  path: string;
  source: WorkflowSource;
}

/** Read one workflow file, or null if it is not reachable. Must not throw. */
export type FetchWorkflow = (
  path: string,
  source: WorkflowSource,
) => Promise<string | null>;

/**
 * Resolve a tag, branch, or SHA to the commit it names, or null when it cannot
 * be resolved. Must not throw.
 *
 * Null is not a cue to fall back to the mutable ref. It leaves every entry
 * behind that source unresolved, which turns the gate red — reading a ref we
 * cannot name is the thing this exists to stop.
 */
export type ResolveRef = (source: SourceRef) => Promise<string | null>;

/**
 * The two reads expansion needs from the outside world, bundled so the recursion
 * carries one parameter instead of two.
 */
export interface WorkflowReader {
  fetchWorkflow: FetchWorkflow;
  resolveRef: ResolveRef;
}

/** A `uses:` that named a workflow file we know how to go and get. */
export interface UsesTarget {
  /** Path inside the target repo, e.g. `.github/workflows/x.yml`. */
  path: string;
  /**
   * null for a local `./` call: the caller's own repo and ref, already
   * resolved. Non-null sources arrive unresolved — the ref is whatever the
   * `uses:` string spelled.
   */
  source: SourceRef | null;
}

/** The two fields the stack walk reads off a PR, whichever route listed it. */
export interface StackNode {
  base: { ref: string };
  merge_commit_sha: string | null;
}
