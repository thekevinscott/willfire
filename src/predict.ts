#!/usr/bin/env node
// Predict the set of CI check entries GitHub Actions will create for a PR.
//
// Usage: pnpm predict --repo owner/name --pr N [--json]
// Auth: GH_TOKEN or GITHUB_TOKEN env var (any token with contents/actions/
// pull-requests read). Inside an action, pass the workflow's GITHUB_TOKEN.
//
// Faithful port of predict.py, which was verified entry-for-entry against
// live dispatches on thekevinbot/willrun-probe (PRs 1-7). Check-name
// resolution was verified the same way on probe PR 8, and cross-repo reusable
// workflow calls on probe PR 9; the rules they turned up are pinned in
// src/names.test.ts.

import { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import {
  makeExecutor,
  makeTreeProvider,
  parseGrant,
  runShell,
  type ExecutionGrant,
  type JobExecutor,
} from "./execute.js";
import { evaluate, evaluateValue, UNKNOWN, type Scope, type Val } from "./expr.js";

interface EntryBase {
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
 * {@link jobName}; reading one is just a string.
 */
export type JobName = string & { readonly __jobName: true };

/** Tag a job display name. Rejects the workflow-level sentinel. */
export const jobName = <S extends string>(name: S extends "*" ? never : S): JobName =>
  name as unknown as JobName;

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

/** Narrow to the workflow-level variant without inspecting the sentinel. */
export const isWorkflowEntry = (e: Entry): e is WorkflowEntry => e.job === "*";

/** Narrow to the job-level variant without inspecting the sentinel. */
export const isJobEntry = (e: Entry): e is JobEntry => e.job !== "*";

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
type DraftWorkflowEntry = Omit<WorkflowEntry, "checkName">;
type DraftJobEntry = Omit<JobEntry, "checkName"> & { checkName?: string | null };
type DraftEntry = DraftWorkflowEntry | DraftJobEntry;

const isWorkflowDraft = (e: DraftEntry): e is DraftWorkflowEntry => e.job === "*";

const finalize = (e: DraftEntry): Entry =>
  isWorkflowDraft(e)
    ? { ...e, checkName: null }
    : { ...e, checkName: e.checkName ?? null };

// ------------------------------------------------- GitHub filter pattern glob
// Grammar per docs: * (any chars except /), ** (any chars), ? (zero or one of
// preceding char), + (one or more of preceding char), [ranges], leading ! negates.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function patternToRegex(pat: string): RegExp {
  let out = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?" || c === "+") {
      out += c;
    } else if (c === "[") {
      const j = pat.indexOf("]", i + 1);
      out += pat.slice(i, j + 1);
      i = j;
    } else if (c === "\\") {
      i++;
      out += escapeRegex(pat[i]);
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}$`);
}

/** Order-sensitive match: last matching pattern wins; ! negates. */
export function matchFilters(value: string, patterns: string[]): boolean {
  let matched = false;
  for (const pat of patterns) {
    const neg = pat.startsWith("!");
    const p = neg ? pat.slice(1) : pat;
    if (patternToRegex(p).test(value)) matched = !neg;
  }
  return matched;
}

// ------------------------------------------------------------ trigger checks

const SKIP_RE = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]/i;
const SKIP_TRAILER_RE = /^skip-checks:\s*true/im;

const DEFAULT_TYPES = ["opened", "synchronize", "reopened"];

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
   * Jobs willfire may *execute* to resolve what reading cannot — the fleet's
   * `detect` job, whose outputs feed every dynamic matrix downstream of it.
   *
   * Off by default, and mechanism only: willfire has no opinion about which
   * jobs are safe to run. The caller that knows names them, one repo and job
   * id at a time (see {@link ExecutionGrant}), and an execution that fails
   * for any reason leaves the dependent entries exactly as unresolved as
   * they were — with the failure spelled into their reasons.
   */
  execute?: ExecutionGrant[];
}

export interface Ctx {
  action: string;
  baseRef: string;
  /**
   * The branch the PR's stack ultimately targets, present only when GitHub's
   * stacked-PR machinery is engaged for this PR (see {@link stackTargetRef}).
   * `branches` / `branches-ignore` are matched against this instead of
   * `baseRef`, because that is what GitHub does — read off dirsql#1002, where
   * `branches: [main]` workflows dispatched on a PR whose base was another
   * PR's head branch (#30).
   */
  stackTarget?: string;
  files: string[];
}

type Workflow = Record<string, any>;

const MISSING = Symbol("missing");

function getPrTrigger(wf: Workflow): Record<string, any> | typeof MISSING {
  // YAML 1.1 parsers read `on` as boolean true; the `yaml` package (1.2)
  // keeps it a string key. Handle both.
  const on = wf["on"] ?? wf["true"];
  if (on == null) return MISSING;
  if (typeof on === "string") return on === "pull_request" ? {} : MISSING;
  if (Array.isArray(on)) return on.includes("pull_request") ? {} : MISSING;
  if (typeof on === "object") {
    if ("pull_request" in on) return on["pull_request"] ?? {};
    return MISSING;
  }
  return MISSING;
}

// A predicate: does this workflow produce a run for the PR? Every workflow-level
// verdict is decidable, so there is no third answer to express. Only job
// expansion can be genuinely undecidable (dynamic matrix, an unreadable
// reusable workflow, unresolvable `if`), and that is a per-entry status.
function workflowDispatches(
  wf: Workflow,
  ctx: Ctx,
): [dispatches: boolean, reason: string] {
  const trig = getPrTrigger(wf);
  if (trig === MISSING) return [false, "no pull_request trigger"];

  const types: string[] = trig["types"] ?? DEFAULT_TYPES;
  if (!types.includes(ctx.action)) {
    return [false, `action '${ctx.action}' not in types [${types}]`];
  }

  // Setting a filter and its -ignore twin on one trigger is invalid config.
  // GitHub does not fall back to "no filter" or skip the workflow: it creates
  // the run and concludes `startup_failure`. The run exists, so it dispatches.
  if ("branches" in trig && "branches-ignore" in trig) {
    return [true, "both branches and branches-ignore set: startup failure"];
  }
  // The name the branch filters are matched against: the literal base branch,
  // or — when the stacked-PR machinery is engaged — the branch the whole stack
  // targets. The reasons name which one was used, so a verdict on a stacked PR
  // is legible without re-deriving the stack.
  const branchRef = ctx.stackTarget ?? ctx.baseRef;
  if ("branches" in trig && !matchFilters(branchRef, trig["branches"])) {
    const label = ctx.stackTarget == null ? "base branch" : "stack target";
    return [false, `${label} '${branchRef}' not in branches`];
  }
  if ("branches-ignore" in trig && matchFilters(branchRef, trig["branches-ignore"])) {
    return [
      false,
      ctx.stackTarget == null
        ? "base branch in branches-ignore"
        : `stack target '${branchRef}' in branches-ignore`,
    ];
  }

  if ("paths" in trig && "paths-ignore" in trig) {
    return [true, "both paths and paths-ignore set: startup failure"];
  }
  if ("paths" in trig && !ctx.files.some((f) => matchFilters(f, trig["paths"]))) {
    return [false, "no changed file matches paths"];
  }
  if ("paths-ignore" in trig && ctx.files.every((f) => matchFilters(f, trig["paths-ignore"]))) {
    return [false, "all changed files match paths-ignore"];
  }

  return [true, "trigger matched"];
}

// ---------------------------------------------------------------- job expansion

type Combo = Record<string, any> | null;

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
interface DetailedCombo {
  values: Record<string, any>;
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
type DetailedCombos = Array<DetailedCombo | null> | null;

/**
 * The values of one matrix axis, or null when they cannot be known.
 *
 * A plain list is itself. An axis written as an expression —
 * `language: ${{ fromJSON(needs.detect.outputs.coverage_languages) }}` — is
 * the values another job computed, and is knowable exactly when the scope
 * carries that job's outputs. Anything else stays null, which is what makes
 * the whole job `unknown` rather than a guess at how many checks it creates.
 */
function axisValues(v: unknown, scope: Scope): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  const val = evaluateValue(v, scope);
  if (val.kind !== "json" || !Array.isArray(val.v)) return null;
  return val.v;
}

function expandMatrixDetailed(strategy: any, scope: Scope = {}): DetailedCombos {
  const matrix = strategy?.matrix;
  if (matrix == null) return [null];
  // `matrix: ${{ ... }}` — the whole matrix as one expression, rather than the
  // per-axis form below. It yields include-style entries, not axes, so it is a
  // separate expansion and is not modelled.
  if (typeof matrix === "string") return null;
  const include: any[] = matrix.include ?? [];
  const exclude: any[] = matrix.exclude ?? [];
  if (typeof include === "string" || typeof exclude === "string") return null;
  const axes: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(matrix)) {
    if (k === "include" || k === "exclude") continue;
    const vals = axisValues(v, scope);
    if (vals == null) return null;
    axes[k] = vals;
  }
  const axisKeys = Object.keys(axes);
  let combos: DetailedCombo[] = [{ values: {}, displayKeys: axisKeys }];
  for (const [k, vals] of Object.entries(axes)) {
    combos = combos.flatMap((c) =>
      vals.map((v) => ({ values: { ...c.values, [k]: v }, displayKeys: axisKeys })),
    );
  }
  if (axisKeys.length === 0) combos = [];
  combos = combos.filter(
    (c) => !exclude.some((ex) => Object.entries(ex).every(([k, v]) => c.values[k] === v)),
  );
  const extra: DetailedCombo[] = [];
  for (const inc of include) {
    const overlapping = Object.fromEntries(
      Object.entries(inc).filter(([k]) => k in axes),
    );
    const targets = combos.filter((c) =>
      Object.entries(overlapping).every(([k, v]) => c.values[k] === v),
    );
    if (axisKeys.length > 0 && targets.length > 0) {
      // Merge into the matching combinations. With no overlapping keys this
      // matches every combination, per the docs ("added to each of the matrix
      // combinations if none of the key:value pairs overwrite any of the
      // original matrix values").
      for (const c of targets) Object.assign(c.values, inc);
    } else {
      // No combination to attach to: the include entry becomes a combination
      // of its own, and every one of its keys shows in the name.
      extra.push({ values: { ...inc }, displayKeys: Object.keys(inc) });
    }
  }
  combos.push(...extra);
  // Zero combinations is a real answer, not a missing one: an empty axis, or an
  // `exclude` that removes everything, schedules no jobs at all. Only an absent
  // `matrix:` key means "one unsuffixed job", and that returned above.
  return combos;
}

/** Return list of matrix combination dicts, or null if dynamic. */
export function expandMatrix(strategy: any, scope: Scope = {}): Combo[] | null {
  const detailed = expandMatrixDetailed(strategy, scope);
  return detailed == null ? null : detailed.map((c) => (c == null ? null : c.values));
}

/**
 * How a single matrix value is rendered inside a check name.
 *
 * Probe-verified: object values are flattened to their own values, so
 * `cfg: {os: linux, arch: x64}` renders as `linux, x64` — the check is
 * `m-object (linux, x64)`.
 */
function formatMatrixValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(formatMatrixValue).join(", ");
  if (typeof v === "object") return Object.values(v).map(formatMatrixValue).join(", ");
  return String(v);
}

/** The ` (v1, v2)` suffix GitHub appends for a matrix combination. */
function matrixSuffix(combo: DetailedCombo): string {
  const keys = combo.displayKeys.filter((k) => k in combo.values);
  if (keys.length === 0) return "";
  return ` (${keys.map((k) => formatMatrixValue(combo.values[k])).join(", ")})`;
}

/**
 * A `name:` that contains any `${{ }}` expression suppresses the matrix
 * parenthetical; a literal one does not.
 *
 * Probe-verified three ways over `a: [x, y]`: `name: Static Label` yields
 * `Static Label (x)` / `Static Label (y)`, `name: ev ${{ github.event_name }}`
 * yields two checks both called `ev pull_request`, and
 * `name: p ${{ matrix.a }}` over `a: [x], b: ["1", "2"]` yields two checks
 * both called `p x`. So the trigger is the presence of an expression, not
 * whether the expression happens to read the matrix — and duplicate check
 * names are a real outcome GitHub allows.
 */
const EXPRESSION_RE = /\$\{\{/;

function lookupPath(obj: any, path: string): unknown {
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object" || !(seg in cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

interface Rendered {
  text: string;
  /** false when an expression was left in place because we cannot evaluate it. */
  resolved: boolean;
}

function renderName(template: string, combo: Combo): Rendered {
  let resolved = true;
  const text = template.replace(/\$\{\{(.*?)\}\}/g, (whole, inner) => {
    const expr = String(inner).trim();
    if (expr.startsWith("matrix.")) {
      if (!combo) {
        resolved = false;
        return whole;
      }
      const val = lookupPath(combo, expr.slice("matrix.".length));
      if (val === undefined) {
        resolved = false;
        return whole;
      }
      return formatMatrixValue(val);
    }
    // We only predict pull_request dispatch, so this one is knowable.
    if (expr === "github.event_name") return "pull_request";
    resolved = false;
    return whole;
  });
  return { text, resolved };
}

interface DisplayName {
  name: string;
  resolved: boolean;
}

/** The check name for one job/combination. */
function jobDisplayName(
  jobId: string,
  job: Workflow,
  combo: DetailedCombo | null,
): DisplayName {
  const raw = job != null && job.name != null ? String(job.name) : null;
  if (raw === null) {
    return { name: jobId + (combo ? matrixSuffix(combo) : ""), resolved: true };
  }
  const { text, resolved } = renderName(raw, combo?.values ?? null);
  const suffix = combo && !EXPRESSION_RE.test(raw) ? matrixSuffix(combo) : "";
  return { name: text + suffix, resolved };
}

/**
 * The check name a job gets when it is skipped.
 *
 * A skipped job is never set up, so nothing about it is evaluated: the matrix
 * does not expand and `name:` is not interpolated. Probe-verified twice over:
 * `if: false` with `a: [x, y]` produces the single check `m-skipped`, not
 * `m-skipped (x)` / `m-skipped (y)`; and `name: sk ${{ github.event_name }}`
 * with `if: false` produces a check literally called
 * `sk ${{ github.event_name }}`, expression text and all. The same collapse
 * applies to a skipped reusable-workflow call: one check named after the
 * caller, with no `/ <callee job>` entries.
 */
function skippedDisplayName(jobId: string, job: Workflow): DisplayName {
  const raw = job != null && job.name != null ? String(job.name) : null;
  return { name: raw ?? jobId, resolved: true };
}

/**
 * The `github.*` values that are fixed for everything this module predicts.
 * `predict` only ever answers for a pull request, so `event_name` is not a
 * variable — which is what lets a `github.event_name == 'pull_request'` guard
 * resolve instead of hanging the job on an unknown.
 */
const PR_GITHUB_CONTEXT: Record<string, string> = { event_name: "pull_request" };

/**
 * A scope with the fixed pull-request facts filled in.
 *
 * Every `${{ }}` this module evaluates — a job `if:`, a matrix axis — is
 * evaluated for the same event, so they all get the same `github.*`. Anything
 * the caller states wins; there is nothing here worth overriding, but a scope
 * that silently ignored what it was handed would be the wrong shape.
 */
const prScope = (scope: Scope): Scope => ({
  ...scope,
  github: { ...PR_GITHUB_CONTEXT, ...scope.github },
});

/**
 * Return run|skipped|unknown for a job-level `if:`.
 *
 * `scope` carries the inputs the calling workflow passed down, and any job
 * outputs the caller knows. Without it a reusable workflow's guards are all
 * unknown, because every one of them is written against `inputs.*` or
 * `needs.*`.
 */
export function evalIf(cond: any, scope: Scope = {}): "run" | "skipped" | "unknown" {
  if (cond == null) return "run";
  const verdict = evaluate(String(cond), prScope(scope));
  if (verdict === null) return "unknown";
  return verdict ? "run" : "skipped";
}

/**
 * A `with:` value as the callee will see it.
 *
 * A value carrying `${{ }}` is left unknown rather than evaluated. Resolving
 * it would mean evaluating the caller's own expression context, and every
 * caller in practice passes plain literals — so the reach that would buy is
 * not worth the surface. Unknown here is the same unknown as before this
 * existed; nothing regresses.
 */
function inputLiteral(raw: unknown): Val {
  if (raw == null) return { kind: "value", v: "" };
  if (typeof raw === "boolean" || typeof raw === "number") return { kind: "value", v: raw };
  if (typeof raw === "string") return raw.includes("${{") ? UNKNOWN : { kind: "value", v: raw };
  return UNKNOWN;
}

/** The `on.workflow_call.inputs` block, tolerating the YAML 1.1 `on` -> true key. */
function workflowCallInputs(wf: Workflow): Record<string, any> {
  const on = wf?.["on"] ?? wf?.["true"];
  if (on == null || typeof on !== "object") return {};
  const call = (on as Record<string, any>)["workflow_call"];
  if (call == null || typeof call !== "object") return {};
  const inputs = call["inputs"];
  return inputs != null && typeof inputs === "object" ? inputs : {};
}

/**
 * What `inputs.*` resolves to inside a called workflow: what the caller passed,
 * over the defaults the callee declares.
 *
 * A declared input the caller omits falls back to its `default`. A declared
 * input with no default and no caller value is unknown rather than empty — the
 * workflow would be invalid if it were required, and guessing empty would
 * silently decide guards that are not decided.
 */
function calleeInputs(withBlock: unknown, subWf: Workflow): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(workflowCallInputs(subWf))) {
    out[name] =
      decl != null && typeof decl === "object" && "default" in decl
        ? inputLiteral((decl as Record<string, unknown>)["default"])
        : UNKNOWN;
  }
  if (withBlock != null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries(withBlock as Record<string, unknown>)) {
      out[name] = inputLiteral(raw);
    }
  }
  return out;
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
 * GitHub allows a reusable-workflow call chain four levels deep. Past that the
 * run itself fails, so anything deeper is not a name we could predict anyway.
 * Probe-verified to three levels: `call-nested / Mid Call / inner`.
 *
 * A cross-repo hop costs the same one level as a local one, so a chain that
 * mixes the two is counted the same way.
 */
const MAX_REUSABLE_DEPTH = 4;

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

/** `ref` is already a commit id, so resolving it is a no-op. */
const SHA_RE = /^[0-9a-f]{40}$/i;

const isSha = (ref: string): boolean => SHA_RE.test(ref);

/** Identity of a source as written, before resolution. */
const sourceKey = (s: SourceRef) => `${s.owner}/${s.repo}@${s.ref}`;

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

/**
 * Split a job-level `uses:` into the file it names and the repo it lives in.
 *
 * Two spellings are legal:
 *
 *   `./.github/workflows/x.yml`              -> the caller's repo, same commit
 *   `owner/repo/.github/workflows/x.yml@ref` -> another repo, at `ref`
 *
 * The ref is taken from the last `@` so a branch containing a slash
 * (`@feature/foo`) survives. Returns null for anything else — including a
 * reference built from an expression, which we cannot evaluate and so must not
 * guess a fetch target for.
 */
export function parseUses(uses: string): UsesTarget | null {
  if (EXPRESSION_RE.test(uses)) return null;
  if (uses.startsWith("./")) {
    const path = uses.slice(2);
    return path === "" ? null : { path, source: null };
  }
  const at = uses.lastIndexOf("@");
  if (at <= 0) return null;
  const ref = uses.slice(at + 1);
  if (ref === "") return null;
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  const path = rest.join("/");
  if (!owner || !repo || path === "") return null;
  return { path, source: { owner, repo, ref } };
}

async function expandJobs(
  wf: Workflow,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  depth = 0,
  prefix = "",
  prefixResolved = true,
  scope: Scope = {},
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  const entries: ExpandedJob[] = [];
  const jobs: Record<string, Workflow> = wf.jobs ?? {};
  const statuses: Record<string, string> = {};

  // Execute what the caller granted, before anything reads `needs`. The
  // grant names the repo the workflow *file* lives in, so a granted callee
  // job fires here in the recursion, where `source` is that repo. The guard
  // is the same `evalIf` the main loop applies — same scope, same verdict —
  // so a job is executed exactly when it is predicted to run. A job that
  // would not run is not executed; a job that fails to execute contributes
  // nothing but its reason, which `execNote` threads into the entries that
  // needed it.
  let scoped = scope;
  const execFailures: Record<string, string> = {};
  if (executor != null) {
    for (const [jobId, jobRaw] of Object.entries(jobs)) {
      if (!executor.granted(source, jobId)) continue;
      const job = jobRaw ?? {};
      if (evalIf(job.if, scoped) !== "run") continue;
      const res = await executor.executeJob(jobId, job, wf, scoped);
      if (res.ok) {
        scoped = { ...scoped, needs: { ...scoped.needs, [jobId]: { outputs: res.outputs } } };
      } else {
        execFailures[jobId] = res.reason;
      }
    }
  }
  const execNote = (needs: string[]): string => {
    const failed = needs.find((n) => n in execFailures);
    return failed == null ? "" : `; executing '${failed}' failed: ${execFailures[failed]}`;
  };

  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    let status = evalIf(job.if, scoped);
    let reason = job.if != null ? `if: ${JSON.stringify(job.if)}` : "";
    let needs: string[] = job.needs ?? [];
    if (typeof needs === "string") needs = [needs];
    const cond = String(job.if ?? "");
    if (status !== "skipped" && !cond.includes("always()")) {
      for (const n of needs) {
        if (statuses[n] === "skipped") {
          status = "skipped";
          reason = `needs '${n}' which is skipped`;
        } else if (statuses[n] === "unknown" && status === "run") {
          status = "unknown";
          reason = `needs '${n}' whose status is unknown`;
        }
      }
    }
    statuses[jobId] = status;

    // A skipped job never expands its matrix and never dispatches a called
    // workflow: it collapses to a single check under the bare job name.
    if (status === "skipped") {
      const disp = skippedDisplayName(jobId, job);
      const name = prefix + disp.name;
      entries.push({
        job: name,
        checkName: prefixResolved && disp.resolved ? name : null,
        status,
        reason,
      });
      continue;
    }

    const combos = expandMatrixDetailed(job.strategy, prScope(scoped));

    if ("uses" in job) {
      // Reusable workflow call. The calling job produces no check of its own;
      // each called job becomes `<calling job name> / <called job name>`, and
      // a matrix on the *caller* multiplies the whole callee set. A cross-repo
      // call names its checks exactly the same way a local one does — probe
      // PR #9, `call-remote-tag / r-inner` alongside `call-plain / inner`.
      const uses: string = job.uses;
      if (combos == null) {
        entries.push({
          job: prefix + jobId,
          checkName: null,
          status: "unknown",
          reason: "dynamic matrix on reusable workflow call" + execNote(needs),
        });
        continue;
      }

      // Resolve the called workflow once, not once per matrix combination.
      let subWf: Workflow | null = null;
      let failure: string | null = null;
      // Where the callee's own `./` calls will resolve. A remote `uses:` moves
      // this to the callee's repo and pinned ref; a local one leaves it alone.
      let subSource: WorkflowSource = source;
      // What `inputs.*` means on the other side of the call.
      let subScope: Scope = {};
      const target = parseUses(uses);
      if (depth + 1 > MAX_REUSABLE_DEPTH) {
        failure = `reusable workflow nested deeper than ${MAX_REUSABLE_DEPTH} levels`;
      } else if (target == null) {
        failure = `unresolvable reusable reference: ${uses}`;
      } else {
        // A local `./` call stays on the caller's source, which is already
        // pinned to a commit. A cross-repo one arrives as whatever the `uses:`
        // string spelled — `@v0` — and has to be resolved before anything is
        // read from it, so the file that gets read and the commit the
        // prediction names are the same one.
        let resolved: WorkflowSource | null = source;
        if (target.source != null) {
          const { ref } = target.source;
          const sha = isSha(ref) ? ref : await reader.resolveRef(target.source);
          resolved = sha == null ? null : { ...target.source, sha };
        }
        if (resolved == null) {
          failure = `cannot resolve ref for ${uses}`;
        } else {
          subSource = resolved;
          const content = await reader.fetchWorkflow(target.path, subSource);
          if (content == null) {
            failure = `cannot fetch ${uses}`;
          } else {
            try {
              subWf = parseYaml(content);
              // `inputs.*` changes at the call boundary; `github.*` does not.
              // A callee's jobs run in the caller's repo, so the facts seeded
              // at the top of the prediction stay true all the way down.
              subScope = { inputs: calleeInputs(job.with, subWf ?? {}), github: scoped.github };
            } catch (e) {
              failure = `YAML parse error in ${uses}: ${e}`;
            }
          }
        }
      }

      for (const combo of combos) {
        const disp = jobDisplayName(jobId, job, combo);
        const baseName = prefix + disp.name;
        const nameResolved = prefixResolved && disp.resolved;
        if (failure != null || subWf == null) {
          entries.push({
            job: baseName,
            checkName: null,
            status: "unknown",
            reason: failure ?? `cannot resolve ${uses}`,
          });
          continue;
        }
        entries.push(
          ...(await expandJobs(
            subWf,
            ctx,
            reader,
            subSource,
            depth + 1,
            `${baseName} / `,
            nameResolved,
            subScope,
            executor,
          )),
        );
      }
      continue;
    }

    if (combos == null) {
      entries.push({
        job: prefix + jobId,
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix" + execNote(needs),
      });
      continue;
    }
    for (const combo of combos) {
      const disp = jobDisplayName(jobId, job, combo);
      const name = prefix + disp.name;
      entries.push({
        job: name,
        checkName: prefixResolved && disp.resolved ? name : null,
        status,
        reason,
      });
    }
  }
  return entries;
}

/**
 * Expand one already-parsed workflow into its job entries. Exported so check
 * names can be tested against recorded GitHub behaviour without a network
 * round-trip; `predict` is the API you want.
 *
 * `scope` seeds what this workflow's own `${{ }}` resolve against — notably
 * `needs`, the outputs of jobs that have not run. Nothing here works out what
 * those are; a caller that knows hands them in, and a caller that does not
 * leaves them out and gets `unknown` where they would have been used.
 */
export function expandWorkflowJobs(
  wf: Workflow,
  ctx: Ctx,
  reader: WorkflowReader,
  source: WorkflowSource,
  scope: Scope = {},
  executor?: JobExecutor,
): Promise<ExpandedJob[]> {
  return expandJobs(wf, ctx, reader, source, 0, "", true, scope, executor);
}

// ------------------------------------------------------------------- pipeline

export function makeOctokit(): Octokit {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN must be set");
  return new Octokit({ auth: token });
}

/**
 * GitHub allows unlimited stacking, but a stack this deep is not a shape any
 * gated repo produces; past it the walk stops at the last proven hop, which
 * only narrows how far up the stack the filter evaluation reaches.
 */
const MAX_STACK_DEPTH = 10;

/** The two fields the stack walk reads off a PR, whichever route listed it. */
interface StackNode {
  base: { ref: string };
  merge_commit_sha: string | null;
}

/**
 * The branch this PR's stack ultimately targets, or null when the PR is a
 * plain one.
 *
 * GitHub's stacked-PR machinery — a server-side feature rolled out per repo —
 * changes how a child PR (one whose base branch is the head of another open
 * PR) is dispatched: its test merge is built on the *parent PR's* test merge
 * instead of the base branch tip, and `on.pull_request.branches` is evaluated
 * against the branch the stack ultimately targets rather than the literal
 * base ref. Observed live on dirsql#1002 (#30): base
 * `claude/tackle-957-lrm0z6`, yet `branches: [main]` workflows dispatched on
 * synchronize. Replicating the stack shape on willrun-probe did not engage
 * the mode, so it cannot be inferred from PR structure — it has to be read
 * off what GitHub actually computed.
 *
 * `merge_commit_sha` is that computation: the test merge's first parent is
 * the base branch tip in normal mode and the parent PR's own
 * `merge_commit_sha` in stacked mode. The walk follows the second equality up
 * the stack to the terminal base ref. Anything undecidable — a null merge
 * sha, an unreadable commit, no open parent PR whose merge sha matches —
 * ends the walk at the last hop it proved, which for a plain PR is today's
 * literal-name semantics. Workflow-level verdicts must stay decidable, so
 * this never throws.
 */
async function stackTargetRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: StackNode,
): Promise<string | null> {
  let target: string | null = null;
  let cur = pr;
  try {
    for (let hop = 0; hop < MAX_STACK_DEPTH; hop++) {
      const mergeSha = cur.merge_commit_sha;
      if (mergeSha == null) break;
      const { data: preview } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: mergeSha,
      });
      const previewParent = preview.parents[0]?.sha;
      if (previewParent == null) break;
      const { data: baseTip } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: cur.base.ref,
      });
      // Built on the base branch tip: normal mode, the walk is done.
      if (previewParent === baseTip.sha) break;
      // The preview was not built on the base tip. Either the base moved since
      // GitHub computed it (stale, and no open PR's merge sha will equal an
      // old branch tip) or it was built on a parent PR's test merge — and only
      // an exact match against an open PR whose head *is* the base branch
      // counts as proof of the second.
      const { data: candidates } = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${cur.base.ref}`,
        per_page: 100,
      });
      const parent = candidates.find((p) => p.merge_commit_sha === previewParent);
      if (parent == null) break;
      target = parent.base.ref;
      cur = parent;
    }
  } catch {
    // Rate limit, permissions, network: stop at the last hop that was proven
    // rather than guessing — same posture as every other read in this module.
  }
  return target;
}

export async function predict(
  octokit: Octokit,
  repo: string,
  prNumber: number,
  opts: PredictOptions = {},
): Promise<Prediction> {
  const [owner, name] = repo.split("/");
  const base = { owner, repo: name };

  const { data: pr } = await octokit.rest.pulls.get({ ...base, pull_number: prNumber });
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...base,
    pull_number: prNumber,
    per_page: 100,
  });
  const stackTarget = await stackTargetRef(octokit, owner, name, pr);
  const ctx: Ctx = {
    // The caller's answer wins whenever it has one. The commit-count fallback
    // is a guess kept only so existing callers keep working.
    action: opts.action ?? (pr.commits > 1 ? "synchronize" : "opened"),
    baseRef: pr.base.ref,
    ...(stackTarget != null ? { stackTarget } : {}),
    files: files.map((f) => f.filename),
  };
  const headSha = pr.head.sha;

  /**
   * The PR's own repo at the head commit — where expansion starts, and already
   * a commit id, so its `ref` and `sha` are the same string.
   */
  const headSource: WorkflowSource = { owner, repo: name, ref: headSha, sha: headSha };

  // Provenance for the answer, filled as expansion reaches each source. The head
  // is in from the start: it is read even on the skip path, where the commit
  // message is what decides the verdict.
  const sources = new Map<string, WorkflowSource>([[sourceKey(headSource), headSource]]);

  const { data: headCommit } = await octokit.rest.repos.getCommit({
    ...base,
    ref: headSha,
  });
  const headMsg = headCommit.commit.message;

  if (SKIP_RE.test(headMsg) || SKIP_TRAILER_RE.test(headMsg)) {
    return finalizePrediction(
      [],
      "head commit message contains a skip instruction",
      sources,
    );
  }

  // A `uses:` naming a tag is the same lookup from every caller that writes it,
  // so resolve each `owner/repo@ref` once. Misses are cached too: a ref that
  // cannot be resolved will not start resolving on the second ask.
  const refCache = new Map<string, string | null>();
  const resolveRef: ResolveRef = async (src) => {
    const key = sourceKey(src);
    const hit = refCache.get(key);
    if (hit !== undefined) return hit;
    let sha: string | null;
    try {
      const { data } = await octokit.rest.repos.getCommit({
        owner: src.owner,
        repo: src.repo,
        ref: src.ref,
      });
      sha = data.sha;
    } catch {
      // Deleted tag, private repo, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      sha = null;
    }
    refCache.set(key, sha);
    if (sha != null) sources.set(key, { ...src, sha });
    return sha;
  };

  // One callee is commonly reached from several callers — a fleet repo calls
  // the same `testing-conventions@v0` from eight workflows — so remember what
  // each `owner/repo/path@sha` resolved to, misses included.
  const cache = new Map<string, string | null>();
  const fetchWorkflow: FetchWorkflow = async (path, src) => {
    // Keyed and fetched on the commit, never the ref that named it. Two callers
    // writing `@v0` and `@abc123` for the same commit are one read, and a tag
    // that moves mid-prediction cannot hand back two different files.
    const key = `${src.owner}/${src.repo}/${path}@${src.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let content: string | null;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: src.owner,
        repo: src.repo,
        path,
        ref: src.sha,
        mediaType: { format: "raw" },
      });
      content = data as unknown as string;
    } catch {
      // Private, deleted, bad ref, rate limit, network: all one answer here.
      // The caller turns it into an `unknown` entry rather than throwing.
      content = null;
    }
    cache.set(key, content);
    return content;
  };

  const reader: WorkflowReader = { fetchWorkflow, resolveRef };

  // The executor exists only when the caller granted something. Trees come
  // from the tarball endpoint at the resolved commit, and every subprocess —
  // `tar` included — goes through the one `runShell` seam.
  let executor: JobExecutor | undefined;
  if (opts.execute != null && opts.execute.length > 0) {
    const download = async (src: WorkflowSource): Promise<Uint8Array | null> => {
      try {
        const { data } = await octokit.rest.repos.downloadTarballArchive({
          owner: src.owner,
          repo: src.repo,
          ref: src.sha,
        });
        return new Uint8Array(data as ArrayBuffer);
      } catch {
        // Private, deleted, rate limit, network: one answer, and the entries
        // behind it stay unresolved with the failure named.
        return null;
      }
    };
    executor = makeExecutor({
      grants: opts.execute,
      workspace: headSource,
      deps: {
        provideTree: makeTreeProvider(download, runShell),
        runCommand: runShell,
        resolveRef,
      },
    });
  }

  const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
    ...base,
    per_page: 100,
  });

  // `github.repository` is fixed for everything predicted here: reusable
  // workflows and composite actions all run in the repo the PR is against.
  // Seeding it once makes guards like the fleet's hermetic-vs-published
  // `github.repository ==` checks decidable everywhere, granted or not.
  const prFacts: Scope = {
    github: { repository: `${headSource.owner}/${headSource.repo}` },
  };

  const entries: DraftEntry[] = [];
  for (const w of workflows) {
    const path = w.path;
    if (!path.startsWith(".github/workflows/")) continue;
    if (w.state !== "active") {
      entries.push({
        workflow: path,
        job: "*",
        status: "no-dispatch",
        reason: `workflow state: ${w.state}`,
      });
      continue;
    }
    const content = await fetchWorkflow(path, headSource);
    if (content == null) {
      // The Actions API keeps listing a workflow as `active` after its file is
      // deleted. There is no file at head, so there is nothing to dispatch —
      // the same verdict as the disabled case above, reached a different way.
      entries.push({
        workflow: path,
        job: "*",
        status: "no-dispatch",
        reason: "no workflow file at head",
      });
      continue;
    }
    let wf: Workflow;
    try {
      wf = parseYaml(content);
    } catch (e) {
      // GitHub creates a run for an unparseable workflow file and concludes it
      // `startup_failure`. The run exists but has no jobs, so this is a
      // workflow-level "it dispatches" with nothing to expand.
      entries.push({
        workflow: path,
        job: "*",
        status: "run",
        reason: `YAML parse error: ${e}`,
      });
      continue;
    }
    const [dispatches, reason] = workflowDispatches(wf, ctx);
    if (!dispatches) {
      entries.push({ workflow: path, job: "*", status: "no-dispatch", reason });
      continue;
    }
    for (const j of await expandJobs(wf, ctx, reader, headSource, 0, "", true, prFacts, executor)) {
      entries.push({
        workflow: path,
        job: jobName(j.job),
        checkName: j.checkName,
        status: j.status,
        reason: j.reason || reason,
      });
    }
  }
  return finalizePrediction(entries, null, sources);
}

function finalizePrediction(
  entries: DraftEntry[],
  skip: string | null,
  sources: Map<string, WorkflowSource>,
): Prediction {
  const final = entries.map(finalize);
  const names = new Set<string>();
  for (const e of final) {
    if (e.status === "run" && e.checkName != null) names.add(e.checkName);
  }
  return {
    entries: final,
    checkNames: [...names].sort(),
    skip,
    sources: [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
  };
}

// ------------------------------------------------------------------------ CLI

const USAGE =
  "usage: predict --repo owner/name --pr N [--action opened|synchronize|reopened]" +
  " [--execute owner/repo:job1,job2]... [--json]";

const isPrEventAction = (v: string): v is PrEventAction =>
  v === "opened" || v === "synchronize" || v === "reopened";

function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  action?: PrEventAction;
  execute: ExecutionGrant[];
} {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("--repo");
  const pr = get("--pr");
  if (!repo || !pr) {
    console.error(USAGE);
    process.exit(2);
  }
  // An unrecognised action is refused rather than ignored. Silently falling
  // back to the guess would turn a typo into a wrong prediction, which is the
  // failure this flag exists to remove.
  const action = get("--action");
  if (action !== undefined && !isPrEventAction(action)) {
    console.error(`unknown --action: ${action}`);
    console.error(USAGE);
    process.exit(2);
  }
  // Repeatable, one grant per flag. A malformed grant is refused for the same
  // reason a bad --action is: silently dropping it would predict without the
  // execution the caller thought they asked for.
  const execute: ExecutionGrant[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--execute") continue;
    const spec = argv[i + 1];
    const grant = spec == null ? null : parseGrant(spec);
    if (grant == null) {
      console.error(`bad --execute: ${spec}`);
      console.error(USAGE);
      process.exit(2);
    }
    execute.push(grant);
  }
  return { repo, pr: Number(pr), json: argv.includes("--json"), action, execute };
}

const isMain = /predict\.(ts|js)$|\/willfire$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const prediction = await predict(makeOctokit(), args.repo, args.pr, {
    action: args.action,
    execute: args.execute,
  });
  const { entries, skip, sources } = prediction;
  if (args.json) {
    console.log(JSON.stringify(prediction, null, 2));
  } else {
    if (skip) {
      console.log(`# ${skip} -> nothing dispatches`);
    } else {
      for (const e of entries) {
        if (isWorkflowEntry(e)) console.log(`# ${e.workflow} :: ${e.status} (${e.reason})`);
        else {
          const name = e.checkName ?? `${e.job} (name unresolved)`;
          console.log(`${e.workflow} :: ${name} :: ${e.status}`);
        }
      }
    }
    // Last, and on the skip path too, so a red gate's first question — which
    // commits was this read from? — is answered wherever the reader lands.
    for (const s of sources) console.log(`# read ${s.owner}/${s.repo}@${s.ref} -> ${s.sha}`);
  }
}
