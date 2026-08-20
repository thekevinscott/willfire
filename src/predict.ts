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
import { evaluate, UNKNOWN, type Scope, type Val } from "./expr.js";

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
  status: "run" | "skipped" | "unknown" | "no-dispatch";
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
}

export interface Ctx {
  action: string;
  baseRef: string;
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
  if ("branches" in trig && !matchFilters(ctx.baseRef, trig["branches"])) {
    return [false, `base branch '${ctx.baseRef}' not in branches`];
  }
  if ("branches-ignore" in trig && matchFilters(ctx.baseRef, trig["branches-ignore"])) {
    return [false, "base branch in branches-ignore"];
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

/** null element = no matrix at all (a single, unsuffixed job). */
type DetailedCombos = Array<DetailedCombo | null> | null;

function expandMatrixDetailed(strategy: any): DetailedCombos {
  const matrix = strategy?.matrix;
  if (matrix == null) return [null];
  if (typeof matrix === "string") return null; // ${{ fromJSON(...) }}
  const include: any[] = matrix.include ?? [];
  const exclude: any[] = matrix.exclude ?? [];
  if (typeof include === "string" || typeof exclude === "string") return null;
  const axes: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(matrix)) {
    if (k === "include" || k === "exclude") continue;
    if (!Array.isArray(v)) return null;
    axes[k] = v;
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
  return combos.length > 0 ? combos : [null];
}

/** Return list of matrix combination dicts, or null if dynamic. */
export function expandMatrix(strategy: any): Combo[] | null {
  const detailed = expandMatrixDetailed(strategy);
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
 * Return run|skipped|unknown for a job-level `if:`.
 *
 * `scope` carries the inputs the calling workflow passed down. Without it a
 * reusable workflow's guards are all unknown, because every one of them is
 * written against `inputs.*`.
 */
export function evalIf(cond: any, scope: Scope = {}): "run" | "skipped" | "unknown" {
  if (cond == null) return "run";
  const verdict = evaluate(String(cond), {
    inputs: scope.inputs,
    github: { ...PR_GITHUB_CONTEXT, ...scope.github },
  });
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
export interface WorkflowSource {
  owner: string;
  repo: string;
  /** Tag, branch, or SHA — whatever `@` was pinned to. */
  ref: string;
}

/** Read one workflow file, or null if it is not reachable. Must not throw. */
export type FetchWorkflow = (
  path: string,
  source: WorkflowSource,
) => Promise<string | null>;

/** A `uses:` that named a workflow file we know how to go and get. */
export interface UsesTarget {
  /** Path inside the target repo, e.g. `.github/workflows/x.yml`. */
  path: string;
  /** null for a local `./` call: the caller's own repo and ref. */
  source: WorkflowSource | null;
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
  fetchWorkflow: FetchWorkflow,
  source: WorkflowSource,
  depth = 0,
  prefix = "",
  prefixResolved = true,
  scope: Scope = {},
): Promise<ExpandedJob[]> {
  const entries: ExpandedJob[] = [];
  const jobs: Record<string, Workflow> = wf.jobs ?? {};
  const statuses: Record<string, string> = {};
  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    let status = evalIf(job.if, scope);
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

    const combos = expandMatrixDetailed(job.strategy);

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
          reason: "dynamic matrix on reusable workflow call",
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
        subSource = target.source ?? source;
        const content = await fetchWorkflow(target.path, subSource);
        if (content == null) {
          failure = `cannot fetch ${uses}`;
        } else {
          try {
            subWf = parseYaml(content);
            subScope = { inputs: calleeInputs(job.with, subWf ?? {}) };
          } catch (e) {
            failure = `YAML parse error in ${uses}: ${e}`;
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
            fetchWorkflow,
            subSource,
            depth + 1,
            `${baseName} / `,
            nameResolved,
            subScope,
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
        reason: "dynamic matrix",
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
 */
export function expandWorkflowJobs(
  wf: Workflow,
  ctx: Ctx,
  fetchWorkflow: FetchWorkflow,
  source: WorkflowSource,
): Promise<ExpandedJob[]> {
  return expandJobs(wf, ctx, fetchWorkflow, source);
}

// ------------------------------------------------------------------- pipeline

export function makeOctokit(): Octokit {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN must be set");
  return new Octokit({ auth: token });
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
  const ctx: Ctx = {
    // The caller's answer wins whenever it has one. The commit-count fallback
    // is a guess kept only so existing callers keep working.
    action: opts.action ?? (pr.commits > 1 ? "synchronize" : "opened"),
    baseRef: pr.base.ref,
    files: files.map((f) => f.filename),
  };
  const headSha = pr.head.sha;
  const { data: headCommit } = await octokit.rest.repos.getCommit({
    ...base,
    ref: headSha,
  });
  const headMsg = headCommit.commit.message;

  if (SKIP_RE.test(headMsg) || SKIP_TRAILER_RE.test(headMsg)) {
    return finalizePrediction([], "head commit message contains a skip instruction");
  }

  /** The PR's own repo at the head commit — where expansion starts. */
  const headSource: WorkflowSource = { owner, repo: name, ref: headSha };

  // One callee is commonly reached from several callers — a fleet repo calls
  // the same `testing-conventions@v0` from eight workflows — so remember what
  // each `owner/repo/path@ref` resolved to, misses included.
  const cache = new Map<string, string | null>();
  const fetchWorkflow: FetchWorkflow = async (path, src) => {
    const key = `${src.owner}/${src.repo}/${path}@${src.ref}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let content: string | null;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: src.owner,
        repo: src.repo,
        path,
        ref: src.ref,
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

  const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
    ...base,
    per_page: 100,
  });

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
    for (const j of await expandJobs(wf, ctx, fetchWorkflow, headSource)) {
      entries.push({
        workflow: path,
        job: jobName(j.job),
        checkName: j.checkName,
        status: j.status,
        reason: j.reason || reason,
      });
    }
  }
  return finalizePrediction(entries, null);
}

function finalizePrediction(entries: DraftEntry[], skip: string | null): Prediction {
  const final = entries.map(finalize);
  const names = new Set<string>();
  for (const e of final) {
    if (e.status === "run" && e.checkName != null) names.add(e.checkName);
  }
  return { entries: final, checkNames: [...names].sort(), skip };
}

// ------------------------------------------------------------------------ CLI

const USAGE =
  "usage: predict --repo owner/name --pr N [--action opened|synchronize|reopened] [--json]";

const isPrEventAction = (v: string): v is PrEventAction =>
  v === "opened" || v === "synchronize" || v === "reopened";

function parseArgs(argv: string[]): {
  repo: string;
  pr: number;
  json: boolean;
  action?: PrEventAction;
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
  return { repo, pr: Number(pr), json: argv.includes("--json"), action };
}

const isMain = /predict\.(ts|js)$|\/willfire$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { entries, checkNames, skip } = await predict(makeOctokit(), args.repo, args.pr, {
    action: args.action,
  });
  if (args.json) {
    console.log(JSON.stringify({ entries, checkNames, skip }, null, 2));
  } else if (skip) {
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
}
