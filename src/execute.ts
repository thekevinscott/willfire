/**
 * Execute a job whose outputs another job reads, to learn what static reading
 * cannot.
 *
 * A dynamic matrix — `language: ${{ fromJSON(needs.detect.outputs.x) }}` — is
 * the values another job computes at runtime. No amount of reading the YAML
 * yields them; the fleet's `detect` job runs a script over the repo tree and
 * writes what it finds to `$GITHUB_OUTPUT`. So this module runs that job the
 * way the runner would: materialize the tree at the pinned commit, walk the
 * steps in order, execute each `run:` under its declared shell and env, and
 * assemble the job's `outputs:` map from what the steps actually wrote.
 *
 * *Which* jobs run is the caller's decision — expansion selects the jobs some
 * sibling's `needs.*.outputs` read actually depends on, so there is nothing to
 * configure. What makes that safe to do by default is the runner: the default
 * `RunCommand` is the hermetic sandbox in `sandbox.ts`, where repo-authored
 * code can reach nothing and keep nothing. Two rules keep the answer honest:
 *
 * 1. **Run it, never interpret it.** The `run:` script is handed to the shell
 *    the step declares, with the env it declares. What lands in
 *    `$GITHUB_OUTPUT` is the answer; no shell text is ever parsed for meaning.
 * 2. **Anything off the modelled path is a hard stop with a reason.** A
 *    Docker action, an undecidable `if:`, a `${{ }}` that will not
 *    resolve, a step that exits non-zero — each fails the execution and says
 *    what it hit, and the consumers of that job's outputs stay unresolved.
 *    Guessing is the one move this module never makes.
 *
 * `actions/checkout` is the deliberate exception to rule 1. It is provided by
 * the runner, not run from its repo, and its whole postcondition — the
 * workspace tree at the commit under test — is something the executor has
 * already satisfied by materializing the tree. A bare checkout is therefore
 * recorded as done, and `fetch-depth: 0` is satisfied by materializing via a
 * full clone instead of a tarball; any other input makes it a different tree
 * than the one provided, and stops. `actions/setup-node` gets the same
 * treatment: the sandbox already ships one node, so asking for that node is
 * done and asking for another is a stop.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { evaluate, evaluateValue, UNKNOWN, type Scope, type Val } from "./expr.js";
import type { ResolveRef, SourceRef, WorkflowSource } from "./types.js";

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
  /** Captured so a failing step can say *why* in its reason. */
  stderr: string;
}

export type RunCommand = (spec: RunSpec) => Promise<RunResult>;

/**
 * Materialize a repo tree at a commit and return its root directory, or null
 * when it cannot be had. Must not throw. `history: true` asks for the tree
 * with its full git history — the postcondition of a `fetch-depth: 0`
 * checkout. A provider that cannot supply that answers null rather than
 * handing back a shallow tree as if it were the deep one.
 */
export type ProvideTree = (
  source: WorkflowSource,
  opts?: { history?: boolean },
) => Promise<string | null>;

/** The reaches into the world an execution needs, bundled for injection. */
export interface ExecDeps {
  provideTree: ProvideTree;
  runCommand: RunCommand;
  resolveRef: ResolveRef;
  /**
   * The node major `runCommand`'s world provides. A `setup-node` or a
   * `node2x` action asking for a different major cannot run truthfully and is
   * refused rather than run under the wrong node.
   */
  nodeMajor: number;
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
  executeJob(jobId: string, job: any, wf: any, scope: Scope): Promise<ExecOutcome>;
}

// ------------------------------------------------------------------ plumbing

/** Internal result: a value or the reason there is none. */
type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

const err = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Render every `${{ }}` in a template to its literal text, or null when any
 * of them cannot be settled. Null rather than a partial render: a script with
 * a hole in it is a different program, and running a different program is the
 * exact lie rule 1 exists to prevent.
 */
export function renderTemplate(text: string, scope: Scope): string | null {
  let failed = false;
  const out = text.replace(/\$\{\{(.*?)\}\}/g, (_whole, inner) => {
    const val = evaluateValue(String(inner), scope);
    if (val.kind !== "value") {
      failed = true;
      return "";
    }
    return String(val.v);
  });
  return failed ? null : out;
}

/** An `env:` block rendered to concrete strings, every key or nothing. */
function renderEnvLayer(layer: unknown, scope: Scope): Res<Record<string, string>> {
  if (layer == null) return { ok: true, v: {} };
  if (typeof layer !== "object" || Array.isArray(layer)) return err("env block is not a map");
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(layer as Record<string, unknown>)) {
    const rendered = renderTemplate(String(raw ?? ""), scope);
    if (rendered == null) return err(`cannot resolve env '${k}'`);
    out[k] = rendered;
  }
  return { ok: true, v: out };
}

/**
 * The `$GITHUB_OUTPUT` file format: `name=value` lines, or a
 * `name<<DELIMITER … DELIMITER` heredoc for multi-line values. Anything else
 * fails the parse — the runner fails the step on a malformed line, so
 * tolerating one here would invent outputs a real run never had.
 */
export function parseGithubOutput(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line === "") continue;
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc != null) {
      const [, name, delim] = heredoc;
      const buf: string[] = [];
      for (;;) {
        if (i >= lines.length) return null; // unterminated heredoc
        if (lines[i] === delim) {
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      out[name] = buf.join("\n");
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) return null;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ------------------------------------------------------------------- actions

/**
 * A step-level `uses:` naming another repo: `owner/repo[/path]@ref`. Unlike a
 * reusable-workflow reference the path may be empty — an action commonly
 * lives at the repo root. Expressions and `docker://` images return null.
 */
function parseActionUses(uses: string): { path: string; source: SourceRef } | null {
  if (uses.includes("${{") || uses.startsWith("docker://")) return null;
  const at = uses.lastIndexOf("@");
  if (at <= 0) return null;
  const ref = uses.slice(at + 1);
  if (ref === "") return null;
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  if (!owner || !repo) return null;
  return { path: rest.join("/"), source: { owner, repo, ref } };
}

/** Read `action.yml` (or `.yaml`) from a directory, or null if neither exists. */
async function readActionManifest(dir: string): Promise<string | null> {
  for (const name of ["action.yml", "action.yaml"]) {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch {
      // fall through to the next spelling
    }
  }
  return null;
}

/**
 * What `inputs.*` means inside a composite action: the caller's `with:`
 * values over the action's declared defaults, everything a string — action
 * inputs are untyped, and an input nobody set is the empty string, not a
 * hole. A value whose `${{ }}` cannot be rendered stays unknown rather than
 * failing here: it only matters if a step actually reads it, and the read is
 * where that failure is honest.
 */
function bindActionInputs(action: any, withBlock: unknown, scope: Scope): Record<string, Val> {
  const bind = (raw: unknown): Val => {
    if (raw == null) return { kind: "value", v: "" };
    if (typeof raw === "boolean" || typeof raw === "number") {
      return { kind: "value", v: String(raw) };
    }
    const rendered = renderTemplate(String(raw), scope);
    return rendered == null ? UNKNOWN : { kind: "value", v: rendered };
  };
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(action?.inputs ?? {})) {
    out[name] =
      decl != null && typeof decl === "object" && "default" in decl
        ? bind((decl as Record<string, unknown>)["default"])
        : { kind: "value", v: "" };
  }
  if (withBlock != null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries(withBlock as Record<string, unknown>)) {
      out[name] = bind(raw);
    }
  }
  return out;
}

// ----------------------------------------------------------------- step walk

/**
 * A cycle guard, not a fidelity claim: a composite action that includes
 * itself would otherwise recurse forever. No executed job in practice nests
 * past one level.
 */
const MAX_ACTION_DEPTH = 4;

const CHECKOUT_RE = /^actions\/checkout@/;

const SETUP_NODE_RE = /^actions\/setup-node@/;

/** What one walk carries besides the expression scope. */
interface WalkCtx {
  /** Workspace root: the PR head tree, where every step runs by default. */
  tree: string;
  /** Whether that tree carries its full git history (a clone, not a tarball). */
  hasHistory: boolean;
  /** Set inside a composite action — where `$GITHUB_ACTION_PATH` points. */
  actionPath?: string;
  /**
   * The materialized repo a remote action came from — the read-only mount
   * unit. A real runner checks out the whole action repo, not just the
   * `uses:` subdirectory, and actions do reach past their own dir
   * (`$GITHUB_ACTION_PATH/../...`), so the mount must match. Unset for local
   * `./` actions, which live inside `tree` and need no extra mount.
   */
  actionRoot?: string;
  /** Raw `env:` blocks from enclosing scopes, outermost first. */
  envLayers: unknown[];
  deps: ExecDeps;
  depth: number;
}

/**
 * Walk steps in order, growing the `steps` context as each one completes.
 * Returns the finished context, or the reason the walk stopped.
 */
async function runSteps(
  steps: any[],
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, { outputs: Record<string, string> }>>> {
  const stepsCtx: Record<string, { outputs: Record<string, string> }> = {};
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] ?? {};
    const label = `step '${step.id ?? step.name ?? `#${i + 1}`}'`;
    const stepScope: Scope = { ...scope, steps: stepsCtx };
    if (step.if != null) {
      const verdict = evaluate(String(step.if), stepScope);
      if (verdict == null) return err(`cannot decide if: for ${label}`);
      if (!verdict) {
        // A skipped step still occupies its id, with no outputs — that is the
        // empty string every later read gets, and what `||` coalesces past.
        if (typeof step.id === "string") stepsCtx[step.id] = { outputs: {} };
        continue;
      }
    }
    let res: Res<Record<string, string>>;
    if (typeof step.uses === "string") {
      res = await runUses(step, label, stepScope, ctx);
    } else if (step.run != null) {
      res = await runRun(step, label, stepScope, ctx);
    } else {
      return err(`${label} has neither uses nor run`);
    }
    if (!res.ok) return res;
    if (typeof step.id === "string") stepsCtx[step.id] = { outputs: res.v };
  }
  return { ok: true, v: stepsCtx };
}

/** A `uses:` step: a runner-provided postcondition, an action to run, or a stop. */
async function runUses(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses: string = step.uses;
  if (CHECKOUT_RE.test(uses)) {
    // Runner-provided, and its postcondition — the head tree at the workspace
    // path — is already true. Only two forms: bare, or `fetch-depth: 0` on a
    // tree that was materialized with history. Any other input — `ref:`,
    // `path:`, `repository:` — makes it a different tree than the one
    // provided.
    const withKeys = step.with == null ? [] : Object.keys(step.with);
    if (withKeys.length === 0) return { ok: true, v: {} };
    if (withKeys.length === 1 && String(step.with["fetch-depth"]) === "0") {
      // Unmet inside a composite action: the pre-scan that picks the tree
      // provider only reads the job's own steps.
      if (!ctx.hasHistory) {
        return err(`${label}: checkout wants history the workspace does not have`);
      }
      return { ok: true, v: {} };
    }
    return err(`${label}: actions/checkout with inputs is not modelled`);
  }
  if (SETUP_NODE_RE.test(uses)) {
    // Runner-provided toolchain setup. The execution world ships exactly one
    // node, so asking for that node (or for nothing) is already satisfied,
    // and asking for any other version — or for caching, registry auth,
    // anything beyond the version — cannot be.
    const withKeys = step.with == null ? [] : Object.keys(step.with);
    if (withKeys.length === 0) return { ok: true, v: {} };
    if (withKeys.length === 1 && withKeys[0] === "node-version") {
      const wanted = renderTemplate(String(step.with["node-version"]), scope);
      if (wanted == null) return err(`${label}: cannot resolve node-version`);
      const m = /^v?(\d+)(\..*)?$/.exec(wanted.trim());
      if (m != null && Number(m[1]) === ctx.deps.nodeMajor) return { ok: true, v: {} };
      return err(
        `${label}: setup-node wants node ${wanted}; the sandbox has node ${ctx.deps.nodeMajor}`,
      );
    }
    return err(`${label}: setup-node with inputs beyond node-version is not modelled`);
  }
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  let actionDir: string;
  let actionRoot: string | undefined;
  if (uses.startsWith("./")) {
    // Relative to the workspace, hermetic-style: the tree under test carries
    // the action. GitHub resolves it the same way.
    actionDir = join(ctx.tree, uses.slice(2));
  } else {
    const target = parseActionUses(uses);
    if (target == null) return err(`${label}: unresolvable uses: ${uses}`);
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha == null) return err(`${label}: cannot resolve ref for ${uses}`);
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root == null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = target.path === "" ? root : join(root, target.path);
    actionRoot = root;
  }
  const manifest = await readActionManifest(actionDir);
  if (manifest == null) return err(`${label}: no action.yml under ${uses}`);
  let action: any;
  try {
    action = parseYaml(manifest);
  } catch (e) {
    return err(`${label}: YAML parse error in ${uses}: ${e}`);
  }
  const using = action?.runs?.using;
  const nodeUsing = /^node(\d+)$/.exec(String(using));
  if (nodeUsing != null) {
    return runNodeAction(
      step,
      label,
      uses,
      action,
      actionDir,
      actionRoot,
      Number(nodeUsing[1]),
      scope,
      ctx,
    );
  }
  if (using !== "composite") {
    // A Docker action is a program with its own runtime and its own view of
    // the world; running one is a promise this executor does not make.
    return err(
      `${label}: action ${uses} runs via '${using}'; only composite and node actions are executed`,
    );
  }
  const childScope: Scope = {
    inputs: bindActionInputs(action, step.with, scope),
    github: scope.github,
  };
  const walked = await runSteps(action?.runs?.steps ?? [], childScope, {
    ...ctx,
    actionPath: actionDir,
    actionRoot,
    depth: ctx.depth + 1,
  });
  if (!walked.ok) return err(`${label} (${uses}): ${walked.reason}`);
  // The action's declared outputs are its whole surface: each `value:` is
  // evaluated against the child's own steps, and every one must land.
  const outScope: Scope = { ...childScope, steps: walked.v };
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries(action.outputs ?? {})) {
    const raw = (decl as Record<string, unknown> | null)?.["value"];
    if (raw == null) return err(`${label}: output '${name}' of ${uses} has no value`);
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered == null) return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}

/**
 * A JavaScript action, run the way the runner runs it: `node <main>` with the
 * caller's inputs bound as `INPUT_*` env vars and outputs read back from
 * `$GITHUB_OUTPUT`. What the program writes there *is* its output surface —
 * the manifest's `outputs:` block on a node action is documentation, not a
 * mapping — so the parsed file is the answer with no further evaluation.
 */
async function runNodeAction(
  step: any,
  label: string,
  uses: string,
  action: any,
  actionDir: string,
  actionRoot: string | undefined,
  usingMajor: number,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  if (usingMajor !== ctx.deps.nodeMajor) {
    return err(
      `${label}: action ${uses} wants node ${usingMajor}; the sandbox has node ${ctx.deps.nodeMajor}`,
    );
  }
  if (action?.runs?.pre != null) {
    return err(`${label}: action ${uses} declares a pre: step; not modelled`);
  }
  // `post:` is deliberately ignored: it runs after the job's own steps, so
  // nothing the job's outputs depend on can come from it.
  const main = action?.runs?.main;
  if (typeof main !== "string") return err(`${label}: action ${uses} has no runs.main`);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository != null) env.GITHUB_REPOSITORY = scope.github.repository;
  if (scope.github?.event_name != null) env.GITHUB_EVENT_NAME = scope.github.event_name;
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) return err(`${label}: ${rendered.reason}`);
    Object.assign(env, rendered.v);
  }
  // Every input the program will see must be concrete. Unlike a composite —
  // where an unknown input only matters if a step reads it — a node action's
  // reads are opaque, so an unresolved binding here is already the failure.
  for (const [name, val] of Object.entries(bindActionInputs(action, step.with, scope))) {
    if (val.kind !== "value") {
      return err(`${label}: cannot resolve input '${name}' of ${uses}`);
    }
    env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] = String(val.v);
  }
  const outDir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const outFile = join(outDir, "output");
  await writeFile(outFile, "");
  // After the layers, so no `env:` block can redirect either one.
  env.GITHUB_OUTPUT = outFile;
  env.WILLFIRE_ACTION_MAIN = join(actionDir, main);
  const r = await ctx.deps.runCommand({
    script: 'exec node "$WILLFIRE_ACTION_MAIN"',
    shell: "bash",
    cwd: ctx.tree,
    env,
    mounts: [
      { path: ctx.tree, writable: true },
      ...(actionRoot != null ? [{ path: actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    const trimmed = r.stderr.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs == null) return err(`${label}: malformed GITHUB_OUTPUT`);
  return { ok: true, v: outputs };
}

/** A `run:` step, executed under its declared shell with its declared env. */
async function runRun(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const shell = step.shell == null ? "bash" : String(step.shell);
  if (shell !== "bash" && shell !== "sh") {
    return err(`${label}: shell '${shell}' is not modelled`);
  }
  const script = renderTemplate(String(step.run), scope);
  if (script == null) return err(`${label}: cannot resolve \${{ }} in run`);
  const env: Record<string, string> = {
    // The two the runner always provides and scripts assume. Everything else
    // a step sees, it declared. (A sandboxed runner swaps PATH and HOME for
    // its own; a direct shell passes them through.)
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository != null) env.GITHUB_REPOSITORY = scope.github.repository;
  if (scope.github?.event_name != null) env.GITHUB_EVENT_NAME = scope.github.event_name;
  if (ctx.actionPath != null) env.GITHUB_ACTION_PATH = ctx.actionPath;
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) return err(`${label}: ${rendered.reason}`);
    Object.assign(env, rendered.v);
  }
  let cwd = ctx.tree;
  if (step["working-directory"] != null) {
    const wd = renderTemplate(String(step["working-directory"]), scope);
    if (wd == null) return err(`${label}: cannot resolve working-directory`);
    cwd = resolve(ctx.tree, wd);
  }
  const outDir = await mkdtemp(join(tmpdir(), "willfire-out-"));
  const outFile = join(outDir, "output");
  await writeFile(outFile, "");
  // After the layers, so no `env:` block can redirect where outputs land.
  env.GITHUB_OUTPUT = outFile;
  const r = await ctx.deps.runCommand({
    script,
    shell,
    cwd,
    env,
    mounts: [
      { path: ctx.tree, writable: true },
      ...(ctx.actionRoot != null ? [{ path: ctx.actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    const trimmed = r.stderr.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs == null) return err(`${label}: malformed GITHUB_OUTPUT`);
  return { ok: true, v: outputs };
}

// ------------------------------------------------------------------ executor

export function makeExecutor(opts: {
  /**
   * The PR's own repo at the head commit — what `actions/checkout` provides
   * on a real runner, wherever the workflow file itself lives. A reusable
   * workflow's jobs run in the caller's workspace; this is that fact.
   */
  workspace: WorkflowSource;
  deps: ExecDeps;
}): JobExecutor {
  const { workspace, deps } = opts;
  const github: Record<string, string> = {
    event_name: "pull_request",
    // Fixed for the run being predicted, and the fact the fleet's
    // hermetic-vs-published guards branch on.
    repository: `${workspace.owner}/${workspace.repo}`,
  };
  const fail = (reason: string): ExecOutcome => ({ ok: false, reason });
  return {
    async executeJob(jobId, job, wf, scope) {
      // The shapes execution does not model, refused by name rather than run
      // wrong: a matrix'd job is several executions, and a container changes
      // what every step means.
      if (job.strategy != null) return fail(`job '${jobId}' has a strategy; not modelled`);
      if (job.container != null || job.services != null) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) return fail(`job '${jobId}' has no steps`);
      // A checkout with any inputs might be the `fetch-depth: 0` form, which
      // needs a workspace with history. Over-asking for a checkout the walk
      // will refuse anyway costs a clone, never correctness.
      const needsHistory = job.steps.some(
        (s: any) =>
          s != null &&
          typeof s.uses === "string" &&
          CHECKOUT_RE.test(s.uses) &&
          s.with != null &&
          Object.keys(s.with).length > 0,
      );
      const tree = await deps.provideTree(workspace, { history: needsHistory });
      if (tree == null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(job.steps, jobScope, {
        tree,
        hasHistory: needsHistory,
        envLayers: [wf?.env, job.env],
        deps,
        depth: 0,
      });
      if (!walked.ok) return fail(walked.reason);
      // The job's `outputs:` map is the whole point of having run anything.
      // Every declared entry must land; a hole here would hand consumers a
      // partial map, which the Scope contract calls a lie.
      const outScope: Scope = { ...jobScope, steps: walked.v };
      const outputs: Record<string, string> = {};
      for (const [name, raw] of Object.entries(job.outputs ?? {})) {
        const rendered = renderTemplate(String(raw), outScope);
        if (rendered == null) return fail(`cannot resolve job output '${name}'`);
        outputs[name] = rendered;
      }
      return { ok: true, outputs };
    },
  };
}

// ------------------------------------------------------------ real-world deps

/**
 * The runner's default shell invocations, faithfully: `bash --noprofile
 * --norc -e -o pipefail` and `sh -e`. Nothing of the parent environment
 * leaks in beyond what the spec names.
 */
export const runShell: RunCommand = (spec) =>
  new Promise((resolvePromise) => {
    const argv =
      spec.shell === "bash"
        ? ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", spec.script]
        : ["-e", "-c", spec.script];
    const child = spawn(spec.shell, argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += String(d);
      // Keep the tail; a failure reason wants the last line, not a transcript.
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });

/**
 * Materialize repo trees from tarballs, one download per commit however many
 * steps ask. GitHub's tarballs wrap the tree in a single
 * `owner-repo-shortsha/` directory, which is unwrapped so callers get the
 * tree root itself. Extraction shells out to `tar` through the same
 * `RunCommand` seam every other subprocess uses.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): ProvideTree {
  const cache = new Map<string, Promise<string | null>>();
  return (source, opts) => {
    // A tarball has no history to give; saying so beats a shallow tree
    // wearing a deep one's name.
    if (opts?.history === true) return Promise.resolve(null);
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const p = materialize(source, download, runCommand);
    cache.set(key, p);
    return p;
  };
}

/**
 * Materialize repo trees by full clone — the provider for `history: true`
 * requests, which a tarball cannot serve. The clone itself runs on the host
 * (it needs the network the sandbox denies); only the tree it produces is
 * later mounted into sandboxed steps.
 *
 * That mounting is why the token never touches the URL or any persisted git
 * config: `.git/config` rides along into the sandbox, so auth travels as a
 * per-invocation `http.extraheader` passed through an env var and is gone
 * when the command is.
 */
export function makeCloneProvider(
  runCommand: RunCommand,
  token: string | null,
  opts: { remoteUrl?: (source: WorkflowSource) => string } = {},
): ProvideTree {
  const remoteUrl =
    opts.remoteUrl ?? ((s: WorkflowSource) => `https://github.com/${s.owner}/${s.repo}.git`);
  const cache = new Map<string, Promise<string | null>>();
  return (source) => {
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const p = cloneAt(source, remoteUrl(source), token, runCommand);
    cache.set(key, p);
    return p;
  };
}

async function cloneAt(
  source: WorkflowSource,
  remote: string,
  token: string | null,
  runCommand: RunCommand,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "willfire-clone-"));
  const dest = join(dir, "tree");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    // A fresh HOME and no system config: nothing of the invoking user's git
    // identity, credential helpers, or hooks reaches this clone.
    HOME: dir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    WILLFIRE_REMOTE: remote,
    WILLFIRE_DEST: dest,
    WILLFIRE_SHA: source.sha,
  };
  let auth = "";
  if (token != null) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    env.WILLFIRE_AUTH = `http.extraheader=AUTHORIZATION: basic ${basic}`;
    auth = ' -c "$WILLFIRE_AUTH"';
  }
  // A PR head commit is not always reachable from any branch — GitHub parks
  // it under `refs/pull/N/head`, which a plain clone does not fetch — so a
  // failed checkout retries after asking the remote for the sha directly.
  const r = await runCommand({
    script: [
      `git${auth} clone --quiet "$WILLFIRE_REMOTE" "$WILLFIRE_DEST"`,
      'cd "$WILLFIRE_DEST"',
      `git checkout --quiet --detach "$WILLFIRE_SHA" 2>/dev/null || {`,
      `  git${auth} fetch --quiet origin "$WILLFIRE_SHA"`,
      '  git checkout --quiet --detach "$WILLFIRE_SHA"',
      "}",
    ].join("\n"),
    shell: "bash",
    cwd: dir,
    env,
  });
  return r.code === 0 ? dest : null;
}

async function materialize(
  source: WorkflowSource,
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): Promise<string | null> {
  const bytes = await download(source);
  if (bytes == null) return null;
  const dir = await mkdtemp(join(tmpdir(), "willfire-tree-"));
  const archive = join(dir, "tree.tar.gz");
  await writeFile(archive, bytes);
  const dest = join(dir, "tree");
  await mkdir(dest);
  const r = await runCommand({
    script: 'tar -xzf "$WILLFIRE_ARCHIVE" -C "$WILLFIRE_DEST"',
    shell: "bash",
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      WILLFIRE_ARCHIVE: archive,
      WILLFIRE_DEST: dest,
    },
  });
  if (r.code !== 0) return null;
  const entries = await readdir(dest);
  if (entries.length === 1) {
    const sub = join(dest, entries[0]);
    if ((await stat(sub)).isDirectory()) return sub;
  }
  return dest;
}
