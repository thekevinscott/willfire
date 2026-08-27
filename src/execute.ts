/**
 * Execute a job whose outputs another job reads, the way the runner would:
 * materialize the tree, walk the steps, read what they wrote to
 * `$GITHUB_OUTPUT`. Two invariants: run it, never interpret it (no shell text
 * is parsed for meaning), and anything off the modelled path is a hard stop
 * with a reason — never a guess.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { evaluate } from "./expr/evaluate.js";
import { evaluateValue } from "./expr/evaluateValue.js";
import { UNKNOWN, type Scope, type Val } from "./expr/val.js";
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
  executeJob(jobId: string, job: any, wf: any, scope: Scope): Promise<ExecOutcome>;
}

// ------------------------------------------------------------------ plumbing

type Res<T> = { ok: true; v: T } | { ok: false; reason: string };

const err = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Render every `${{ }}` to literal text, or null when any cannot be settled —
 * a partial render would be a different program.
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
  if (layer == null) {
    return { ok: true, v: {} };
  }
  if (typeof layer !== "object" || Array.isArray(layer)) {
    return err("env block is not a map");
  }
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(layer as Record<string, unknown>)) {
    const rendered = renderTemplate(String(raw ?? ""), scope);
    if (rendered == null) {
      return err(`cannot resolve env '${k}'`);
    }
    out[k] = rendered;
  }
  return { ok: true, v: out };
}

/**
 * `name=value` lines or `name<<DELIMITER` heredocs. Anything else fails the
 * parse, as the runner fails the step on a malformed line.
 */
export function parseGithubOutput(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line === "") {
      continue;
    }
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc != null) {
      const [, name, delim] = heredoc;
      const buf: string[] = [];
      for (;;) {
        if (i >= lines.length) {
          return null; // unterminated heredoc
        }
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
    if (eq <= 0) {
      return null;
    }
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// ------------------------------------------------------------------- actions

/**
 * `owner/repo[/path]@ref` — unlike a reusable-workflow reference the path may
 * be empty, since an action commonly lives at the repo root.
 */
function parseActionUses(uses: string): { path: string; source: SourceRef } | null {
  if (uses.includes("${{") || uses.startsWith("docker://")) {
    return null;
  }
  const at = uses.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const ref = uses.slice(at + 1);
  if (ref === "") {
    return null;
  }
  const [owner, repo, ...rest] = uses.slice(0, at).split("/");
  if (!owner || !repo) {
    return null;
  }
  return { path: rest.join("/"), source: { owner, repo, ref } };
}

async function readActionManifest(dir: string): Promise<string | null> {
  for (const name of ["action.yml", "action.yaml"]) {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch {
      /* try the other spelling */
    }
  }
  return null;
}

/**
 * Caller's `with:` over declared defaults, everything a string — action inputs
 * are untyped, and an unset input is the empty string. An unrenderable value
 * stays unknown; it only fails if a step reads it.
 */
function bindActionInputs(action: any, withBlock: unknown, scope: Scope): Record<string, Val> {
  const bind = (raw: unknown): Val => {
    if (raw == null) {
      return { kind: "value", v: "" };
    }
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

/** A cycle guard, not a fidelity claim — a self-including composite would recurse forever. */
const MAX_ACTION_DEPTH = 4;

const CHECKOUT_RE = /^actions\/checkout@/;

const SETUP_NODE_RE = /^actions\/setup-node@/;

interface WalkCtx {
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
  envLayers: unknown[];
  deps: ExecDeps;
  depth: number;
}

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
      if (verdict == null) {
        return err(`cannot decide if: for ${label}`);
      }
      if (!verdict) {
        // A skipped step still occupies its id, with no outputs.
        if (typeof step.id === "string") {
          stepsCtx[step.id] = { outputs: {} };
        }
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
    if (!res.ok) {
      return res;
    }
    if (typeof step.id === "string") {
      stepsCtx[step.id] = { outputs: res.v };
    }
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
    // path — is already true. Any input beyond `fetch-depth: 0` asks for a
    // different tree than the one provided.
    const withKeys = Object.keys(step.with ?? {});
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && String(step.with["fetch-depth"]) === "0") {
      // Unmet inside a composite: the pre-scan that picks the tree provider
      // only reads the job's own steps.
      if (!ctx.hasHistory) {
        return err(`${label}: checkout wants history the workspace does not have`);
      }
      return { ok: true, v: {} };
    }
    return err(`${label}: actions/checkout with inputs is not modelled`);
  }
  if (SETUP_NODE_RE.test(uses)) {
    // The execution world ships exactly one node: asking for it is already
    // satisfied, asking for anything else cannot be.
    const withKeys = Object.keys(step.with ?? {});
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && withKeys[0] === "node-version") {
      const wanted = renderTemplate(String(step.with["node-version"]), scope);
      if (wanted === null) {
        return err(`${label}: cannot resolve node-version`);
      }
      const m = /^v?(\d+)(\..*)?$/.exec(wanted.trim());
      if (m !== null && Number(m[1]) === ctx.deps.nodeMajor) {
        return { ok: true, v: {} };
      }
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
    actionDir = join(ctx.tree, uses.slice(2));
  } else {
    const target = parseActionUses(uses);
    if (target == null) {
      return err(`${label}: unresolvable uses: ${uses}`);
    }
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha == null) {
      return err(`${label}: cannot resolve ref for ${uses}`);
    }
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root == null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = target.path === "" ? root : join(root, target.path);
    actionRoot = root;
  }
  const manifest = await readActionManifest(actionDir);
  if (manifest == null) {
    return err(`${label}: no action.yml under ${uses}`);
  }
  let action: any;
  try {
    action = parseYaml(manifest);
  } catch (e) {
    return err(`${label}: YAML parse error in ${uses}: ${e}`);
  }
  const using = action?.runs?.using;
  const nodeUsing = /^node(\d+)$/.exec(String(using));
  if (nodeUsing !== null) {
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
  if (!walked.ok) {
    return err(`${label} (${uses}): ${walked.reason}`);
  }
  // Every declared output must land; a partial map would be a lie.
  const outScope: Scope = { ...childScope, steps: walked.v };
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries(action.outputs ?? {})) {
    const raw = (decl as Record<string, unknown> | null)?.["value"];
    if (raw == null) {
      return err(`${label}: output '${name}' of ${uses} has no value`);
    }
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered == null) {
      return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    }
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}

/**
 * `node <main>` with inputs bound as `INPUT_*` env vars. What lands in
 * `$GITHUB_OUTPUT` is the whole output surface — a node action's manifest
 * `outputs:` block is documentation, not a mapping.
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
  if (action?.runs?.pre !== undefined && action.runs.pre !== null) {
    return err(`${label}: action ${uses} declares a pre: step; not modelled`);
  }
  // `post:` runs after the job's own steps, so no job output can depend on it.
  const main = action?.runs?.main;
  if (typeof main !== "string") {
    return err(`${label}: action ${uses} has no runs.main`);
  }
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository !== undefined) {
    env.GITHUB_REPOSITORY = scope.github.repository;
  }
  if (scope.github?.event_name !== undefined) {
    env.GITHUB_EVENT_NAME = scope.github.event_name;
  }
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) {
      return err(`${label}: ${rendered.reason}`);
    }
    Object.assign(env, rendered.v);
  }
  // Unlike a composite's, a node action's input reads are opaque, so every
  // binding must be concrete up front.
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
      ...(actionRoot !== undefined ? [{ path: actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    const trimmed = r.stderr.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs === null) {
    return err(`${label}: malformed GITHUB_OUTPUT`);
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
  if (script == null) {
    return err(`${label}: cannot resolve \${{ }} in run`);
  }
  const env: Record<string, string> = {
    // Everything else a step sees, it declared. A sandboxed runner swaps PATH
    // and HOME for its own.
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository !== undefined) {
    env.GITHUB_REPOSITORY = scope.github.repository;
  }
  if (scope.github?.event_name !== undefined) {
    env.GITHUB_EVENT_NAME = scope.github.event_name;
  }
  if (ctx.actionPath !== undefined) {
    env.GITHUB_ACTION_PATH = ctx.actionPath;
  }
  for (const layer of [...ctx.envLayers, step.env]) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) {
      return err(`${label}: ${rendered.reason}`);
    }
    Object.assign(env, rendered.v);
  }
  let cwd = ctx.tree;
  if (step["working-directory"] != null) {
    const wd = renderTemplate(String(step["working-directory"]), scope);
    if (wd == null) {
      return err(`${label}: cannot resolve working-directory`);
    }
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
      ...(ctx.actionRoot !== undefined ? [{ path: ctx.actionRoot, writable: false }] : []),
      { path: outDir, writable: true },
    ],
  });
  if (r.code !== 0) {
    const trimmed = r.stderr.trim();
    const tail = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return err(`${label}: exited ${r.code}${tail === "" ? "" : ` (${tail})`}`);
  }
  const outputs = parseGithubOutput(await readFile(outFile, "utf8"));
  if (outputs == null) {
    return err(`${label}: malformed GITHUB_OUTPUT`);
  }
  return { ok: true, v: outputs };
}

// ------------------------------------------------------------------ executor

export function makeExecutor(opts: {
  /**
   * The PR's own repo at the head commit. A reusable workflow's jobs run in
   * the caller's workspace, wherever the workflow file lives.
   */
  workspace: WorkflowSource;
  deps: ExecDeps;
}): JobExecutor {
  const { workspace, deps } = opts;
  const github: Record<string, string> = {
    event_name: "pull_request",
    repository: `${workspace.owner}/${workspace.repo}`,
  };
  const fail = (reason: string): ExecOutcome => ({ ok: false, reason });
  return {
    async executeJob(jobId, job, wf, scope) {
      if (job.strategy !== undefined && job.strategy !== null) {
        return fail(`job '${jobId}' has a strategy; not modelled`);
      }
      if (job.container != null || job.services != null) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) {
        return fail(`job '${jobId}' has no steps`);
      }
      // Any checkout input might be the `fetch-depth: 0` form. Over-asking for
      // one the walk will refuse anyway costs a clone, never correctness.
      const needsHistory = job.steps.some(
        (s: any) =>
          s !== null &&
          s !== undefined &&
          typeof s.uses === "string" &&
          CHECKOUT_RE.test(s.uses) &&
          Object.keys(s.with ?? {}).length > 0,
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
      if (!walked.ok) {
        return fail(walked.reason);
      }
      // Every declared output must land; a partial map would be a lie.
      const outScope: Scope = { ...jobScope, steps: walked.v };
      const outputs: Record<string, string> = {};
      for (const [name, raw] of Object.entries(job.outputs ?? {})) {
        const rendered = renderTemplate(String(raw), outScope);
        if (rendered == null) {
          return fail(`cannot resolve job output '${name}'`);
        }
        outputs[name] = rendered;
      }
      return { ok: true, outputs };
    },
  };
}

// ------------------------------------------------------------ real-world deps

/**
 * The runner's default shell invocations, faithfully. Nothing of the parent
 * environment leaks in beyond what the spec names.
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
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });

/**
 * Materialize repo trees from tarballs, one download per commit. GitHub wraps
 * the tree in a single `owner-repo-shortsha/` directory, unwrapped here.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): ProvideTree {
  const cache = new Map<string, Promise<string | null>>();
  return (source, opts) => {
    // A tarball has no history to give.
    if (opts?.history === true) {
      return Promise.resolve(null);
    }
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const p = materialize(source, download, runCommand);
    cache.set(key, p);
    return p;
  };
}

/**
 * Materialize repo trees by full clone, on the host — it needs the network
 * the sandbox denies. The token never touches the URL or persisted git
 * config, because `.git/config` later rides into the sandbox: auth travels
 * as a per-invocation `http.extraheader` and is gone when the command is.
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
    if (hit !== undefined) {
      return hit;
    }
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
    // A fresh HOME and no system config: none of the invoking user's git
    // identity or credential helpers reach this clone.
    HOME: dir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    WILLFIRE_REMOTE: remote,
    WILLFIRE_DEST: dest,
    WILLFIRE_SHA: source.sha,
  };
  let auth = "";
  if (token !== null) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    env.WILLFIRE_AUTH = `http.extraheader=AUTHORIZATION: basic ${basic}`;
    auth = ' -c "$WILLFIRE_AUTH"';
  }
  // A PR head commit may live only under `refs/pull/N/head`, which a plain
  // clone does not fetch, so a failed checkout retries via a direct fetch.
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
  if (bytes == null) {
    return null;
  }
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
  if (r.code !== 0) {
    return null;
  }
  const entries = await readdir(dest);
  if (entries.length === 1) {
    const sub = join(dest, entries[0]);
    if ((await stat(sub)).isDirectory()) {
      return sub;
    }
  }
  return dest;
}
