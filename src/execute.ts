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

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { evaluate, evaluateValue, UNKNOWN, type Scope, type Val } from "./expr.js";
import type { ResolveRef, SourceRef, WorkflowSource } from "./types.js";

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

/** `owner/repo:job1,job2` as the CLI spells a grant. */
export function parseGrant(spec: string): ExecutionGrant | null {
  const colon = spec.indexOf(":");
  if (colon <= 0) return null;
  const repo = spec.slice(0, colon);
  const parts = repo.split("/");
  if (parts.length !== 2 || parts.some((p) => p === "")) return null;
  const jobs = spec
    .slice(colon + 1)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (jobs.length === 0) return null;
  return { repo, jobs };
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

// ------------------------------------------------------------------ plumbing

/** Internal result: a value or the reason there is none. */
type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

const err = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Render every `${{ }}` in a template to its literal text, or null when any
 * of them cannot be settled. Null rather than a partial render: a script with
 * a hole in it is a different program, and running a different program is the
 * exact lie rule 2 exists to prevent.
 */
function renderTemplate(text: string, scope: Scope): string | null {
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
 * itself would otherwise recurse forever. No granted job in practice nests
 * past one level.
 */
const MAX_ACTION_DEPTH = 4;

const CHECKOUT_RE = /^actions\/checkout@/;

/** What one walk carries besides the expression scope. */
interface WalkCtx {
  /** Workspace root: the PR head tree, where every step runs by default. */
  tree: string;
  /** Set inside a composite action — where `$GITHUB_ACTION_PATH` points. */
  actionPath?: string;
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

/** A `uses:` step: checkout's postcondition, or a composite action, or a stop. */
async function runUses(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses: string = step.uses;
  if (CHECKOUT_RE.test(uses)) {
    // Runner-provided, and its postcondition — the head tree at the workspace
    // path — is already true. But only the bare form: `ref:`, `path:`,
    // `repository:` each make it a different tree than the one provided.
    if (step.with != null && Object.keys(step.with).length > 0) {
      return err(`${label}: actions/checkout with inputs is not modelled`);
    }
    return { ok: true, v: {} };
  }
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  let actionDir: string;
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
  if (using !== "composite") {
    // A JavaScript or Docker action is a program with its own runtime and its
    // own view of the world. Running one is a much larger promise than
    // running a shell step, and no granted job needs it.
    return err(`${label}: action ${uses} runs via '${using}'; only composite actions are executed`);
  }
  const childScope: Scope = {
    inputs: bindActionInputs(action, step.with, scope),
    github: scope.github,
  };
  const walked = await runSteps(action?.runs?.steps ?? [], childScope, {
    ...ctx,
    actionPath: actionDir,
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
    // a step sees, it declared.
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
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
  const r = await ctx.deps.runCommand({ script, shell, cwd, env });
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
  grants: ExecutionGrant[];
  /**
   * The PR's own repo at the head commit — what `actions/checkout` provides
   * on a real runner, wherever the workflow file itself lives. A reusable
   * workflow's jobs run in the caller's workspace; this is that fact.
   */
  workspace: WorkflowSource;
  deps: ExecDeps;
}): JobExecutor {
  const { grants, workspace, deps } = opts;
  const github: Record<string, string> = {
    event_name: "pull_request",
    // Fixed for the run being predicted, and the fact the fleet's
    // hermetic-vs-published guards branch on.
    repository: `${workspace.owner}/${workspace.repo}`,
  };
  const fail = (reason: string): ExecOutcome => ({ ok: false, reason });
  return {
    granted: (source, jobId) =>
      grants.some(
        (g) => g.repo === `${source.owner}/${source.repo}` && g.jobs.includes(jobId),
      ),
    async executeJob(jobId, job, wf, scope) {
      // The shapes execution does not model, refused by name rather than run
      // wrong: a matrix'd job is several executions, and a container changes
      // what every step means.
      if (job.strategy != null) return fail(`job '${jobId}' has a strategy; not modelled`);
      if (job.container != null || job.services != null) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) return fail(`job '${jobId}' has no steps`);
      const tree = await deps.provideTree(workspace);
      if (tree == null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(job.steps, jobScope, {
        tree,
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
  return (source) => {
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const p = materialize(source, download, runCommand);
    cache.set(key, p);
    return p;
  };
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
