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
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { bindActionInputs } from "./execute/bindActionInputs.js";
import { err } from "./execute/err.js";
import { renderTemplate } from "./execute/renderTemplate.js";
import { runNodeAction } from "./execute/runNodeAction.js";
import { runRun } from "./execute/runRun.js";
import type {
  ActionModel,
  ExecDeps,
  ExecOutcome,
  JobExecutor,
  ProvideTree,
  Res,
  RunCommand,
  StepModel,
  WalkCtx,
} from "./execute/types.js";
import { evaluate } from "./expr/evaluate.js";
import type { Scope } from "./expr/val.js";
import type { SourceRef, WorkflowSource } from "./types.js";
import type { YamlMap, YamlValue } from "./yamlValue.js";

const SHA_RE = /^[0-9a-f]{40}$/i;

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

// ----------------------------------------------------------------- step walk

/** A cycle guard, not a fidelity claim — a self-including composite would recurse forever. */
const MAX_ACTION_DEPTH = 4;

const CHECKOUT_RE = /^actions\/checkout@/;

const SETUP_NODE_RE = /^actions\/setup-node@/;

async function runSteps(
  steps: StepModel[],
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, { outputs: Record<string, string> }>>> {
  const stepsCtx: Record<string, { outputs: Record<string, string> }> = {};
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] ?? {};
    const label = `step '${step.id ?? step.name ?? `#${i + 1}`}'`;
    const stepScope: Scope = { ...scope, steps: stepsCtx };
    let skipped = false;
    if (step.if !== undefined && step.if !== null) {
      const verdict = evaluate(String(step.if), stepScope);
      if (verdict === null) {
        return err(`cannot decide if: for ${label}`);
      }
      skipped = !verdict;
    }
    if (skipped) {
      // A skipped step still occupies its id, with no outputs.
      if (typeof step.id === "string") {
        stepsCtx[step.id] = { outputs: {} };
      }
    } else {
      let res: Res<Record<string, string>>;
      if (typeof step.uses === "string") {
        res = await runUses(step, label, stepScope, ctx);
      } else if (step.run !== undefined && step.run !== null) {
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
  }
  return { ok: true, v: stepsCtx };
}

/** A `uses:` step: a runner-provided postcondition, an action to run, or a stop. */
async function runUses(
  step: StepModel,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses = step.uses as string;
  const withBlock: YamlMap = step.with ?? {};
  if (CHECKOUT_RE.test(uses)) {
    // Runner-provided, and its postcondition — the head tree at the workspace
    // path — is already true. Any input beyond `fetch-depth: 0` asks for a
    // different tree than the one provided.
    const withKeys = Object.keys(withBlock);
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && String(withBlock["fetch-depth"]) === "0") {
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
    // satisfied, asking for anything else cannot be. setup-node reads every
    // input through core.getInput, which trims and cannot tell an empty value
    // from an absent one, so an empty one asks for nothing.
    const withKeys = Object.entries(withBlock)
      .filter(([, raw]) => {
        const rendered = renderTemplate(String(raw ?? ""), scope);
        return rendered === null || rendered.trim() !== "";
      })
      .map(([k]) => k);
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && withKeys[0] === "node-version") {
      const wanted = renderTemplate(String(withBlock["node-version"]), scope);
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
    if (target === null) {
      return err(`${label}: unresolvable uses: ${uses}`);
    }
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha === null) {
      return err(`${label}: cannot resolve ref for ${uses}`);
    }
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root === null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = join(root, target.path);
    actionRoot = root;
  }
  const manifest = await readActionManifest(actionDir);
  if (manifest === null) {
    return err(`${label}: no action.yml under ${uses}`);
  }
  let action: ActionModel;
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
  for (const [name, decl] of Object.entries<YamlValue | undefined>(action.outputs ?? {})) {
    const raw = (decl as YamlMap | null)?.["value"];
    if (raw === null || raw === undefined) {
      return err(`${label}: output '${name}' of ${uses} has no value`);
    }
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered === null) {
      return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    }
    outputs[name] = rendered;
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
      if (job.container !== null && job.container !== undefined) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (job.services !== null && job.services !== undefined) {
        return fail(`job '${jobId}' uses a container or services; not modelled`);
      }
      if (!Array.isArray(job.steps)) {
        return fail(`job '${jobId}' has no steps`);
      }
      const steps = job.steps as StepModel[];
      // Any checkout input might be the `fetch-depth: 0` form. Over-asking for
      // one the walk will refuse anyway costs a clone, never correctness.
      const needsHistory = steps.some(
        (s) =>
          s !== null &&
          s !== undefined &&
          typeof s.uses === "string" &&
          CHECKOUT_RE.test(s.uses) &&
          Object.keys(s.with ?? {}).length > 0,
      );
      const tree = await deps.provideTree(workspace, { history: needsHistory });
      if (tree === null) {
        return fail(
          `cannot materialize workspace ${workspace.owner}/${workspace.repo}@${workspace.sha}`,
        );
      }
      const jobScope: Scope = { ...scope, github: { ...github, ...scope.github } };
      const walked = await runSteps(steps, jobScope, {
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
        if (rendered === null) {
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
  if (bytes === null) {
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
