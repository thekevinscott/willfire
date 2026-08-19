#!/usr/bin/env node
// Predict the set of CI check entries GitHub Actions will create for a PR.
//
// Usage: pnpm predict --repo owner/name --pr N [--json]
// Auth: GH_TOKEN or GITHUB_TOKEN env var (any token with contents/actions/
// pull-requests read). Inside an action, pass the workflow's GITHUB_TOKEN.
//
// Faithful port of predict.py, which was verified entry-for-entry against
// live dispatches on thekevinbot/willrun-probe (PRs 1-7).

import { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";

export interface Entry {
  workflow: string;
  job: string; // "*" = workflow-level verdict, no job entries
  status: "run" | "skipped" | "unknown" | "no-dispatch";
  reason: string;
}

export interface Prediction {
  entries: Entry[];
  skip: string | null; // set when a skip instruction suppresses everything
}

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

interface Ctx {
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

function workflowDispatches(
  wf: Workflow,
  ctx: Ctx,
): ["dispatch" | "no-dispatch" | "unknown", string] {
  const trig = getPrTrigger(wf);
  if (trig === MISSING) return ["no-dispatch", "no pull_request trigger"];

  const types: string[] = trig["types"] ?? DEFAULT_TYPES;
  if (!types.includes(ctx.action)) {
    return ["no-dispatch", `action '${ctx.action}' not in types [${types}]`];
  }

  if ("branches" in trig && "branches-ignore" in trig) {
    return ["unknown", "both branches and branches-ignore set"];
  }
  if ("branches" in trig && !matchFilters(ctx.baseRef, trig["branches"])) {
    return ["no-dispatch", `base branch '${ctx.baseRef}' not in branches`];
  }
  if ("branches-ignore" in trig && matchFilters(ctx.baseRef, trig["branches-ignore"])) {
    return ["no-dispatch", "base branch in branches-ignore"];
  }

  if ("paths" in trig && "paths-ignore" in trig) {
    return ["unknown", "both paths and paths-ignore set"];
  }
  if ("paths" in trig && !ctx.files.some((f) => matchFilters(f, trig["paths"]))) {
    return ["no-dispatch", "no changed file matches paths"];
  }
  if ("paths-ignore" in trig && ctx.files.every((f) => matchFilters(f, trig["paths-ignore"]))) {
    return ["no-dispatch", "all changed files match paths-ignore"];
  }

  return ["dispatch", "trigger matched"];
}

// ---------------------------------------------------------------- job expansion

type Combo = Record<string, any> | null;

/** Return list of matrix combination dicts, or null if dynamic. */
export function expandMatrix(strategy: any): Combo[] | null {
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
  let combos: Record<string, any>[] = [{}];
  for (const [k, vals] of Object.entries(axes)) {
    combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
  }
  if (Object.keys(axes).length === 0) combos = [];
  combos = combos.filter(
    (c) => !exclude.some((ex) => Object.entries(ex).every(([k, v]) => c[k] === v)),
  );
  const extra: Record<string, any>[] = [];
  for (const inc of include) {
    const overlapping = Object.fromEntries(
      Object.entries(inc).filter(([k]) => k in axes),
    );
    const targets = combos.filter((c) =>
      Object.entries(overlapping).every(([k, v]) => c[k] === v),
    );
    if (Object.keys(overlapping).length > 0 && targets.length > 0) {
      for (const c of targets) Object.assign(c, inc);
    } else {
      extra.push({ ...inc });
    }
  }
  combos.push(...extra);
  return combos.length > 0 ? combos : [null];
}

function renderName(template: string, combo: Combo): string {
  return template.replace(/\$\{\{(.*?)\}\}/g, (whole, inner) => {
    const expr = String(inner).trim();
    if (expr.startsWith("matrix.") && combo) {
      return String(combo[expr.slice("matrix.".length)] ?? "");
    }
    return whole;
  });
}

function jobDisplayName(jobId: string, job: Workflow, combo: Combo): string {
  if ("name" in job && job.name != null) return renderName(String(job.name), combo);
  let name = jobId;
  if (combo) name += ` (${Object.values(combo).map(String).join(", ")})`;
  return name;
}

/** Return run|skipped|unknown for a job-level if. */
export function evalIf(cond: any): "run" | "skipped" | "unknown" {
  if (cond == null) return "run";
  let c = String(cond).trim();
  c = c.replace(/^\$\{\{(.*)\}\}$/s, "$1").trim();
  if (c === "false" || c === "False") return "skipped";
  if (c === "true" || c === "True" || c === "always()") return "run";
  const m = c.match(/^github\.event_name\s*(==|!=)\s*'([^']*)'$/);
  if (m) {
    const eq = m[2] === "pull_request";
    const hit = m[1] === "==" ? eq : !eq;
    return hit ? "run" : "skipped";
  }
  return "unknown";
}

type JobEntry = [name: string, status: "run" | "skipped" | "unknown", reason: string];

async function expandJobs(
  wf: Workflow,
  ctx: Ctx,
  fetchFile: (path: string) => Promise<string | null>,
  depth = 0,
  prefix = "",
): Promise<JobEntry[]> {
  const entries: JobEntry[] = [];
  const jobs: Record<string, Workflow> = wf.jobs ?? {};
  const statuses: Record<string, string> = {};
  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    let status = evalIf(job.if);
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

    if ("uses" in job) {
      // reusable workflow call
      const uses: string = job.uses;
      const baseName = prefix + (job.name != null ? String(job.name) : jobId);
      if (depth >= 1) {
        entries.push([baseName, "unknown", "nested reusable workflow"]);
        continue;
      }
      const m = uses.match(/^\.\/(.+)$/);
      if (!m) {
        entries.push([baseName, "unknown", `non-local reusable: ${uses}`]);
        continue;
      }
      const content = await fetchFile(m[1]);
      if (content == null) {
        entries.push([baseName, "unknown", `cannot fetch ${uses}`]);
        continue;
      }
      if (status === "skipped") {
        entries.push([baseName, "skipped", reason]);
        continue;
      }
      const subWf = parseYaml(content);
      const sub = await expandJobs(subWf, ctx, fetchFile, depth + 1, `${baseName} / `);
      entries.push(...sub);
      continue;
    }

    const combos = expandMatrix(job.strategy);
    if (combos == null) {
      entries.push([prefix + jobId, "unknown", "dynamic matrix"]);
      continue;
    }
    for (const combo of combos) {
      entries.push([prefix + jobDisplayName(jobId, job, combo), status, reason]);
    }
  }
  return entries;
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
    action: pr.commits > 1 ? "synchronize" : "opened",
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
    return { entries: [], skip: "head commit message contains a skip instruction" };
  }

  const fetchFile = async (path: string): Promise<string | null> => {
    try {
      const { data } = await octokit.rest.repos.getContent({
        ...base,
        path,
        ref: headSha,
        mediaType: { format: "raw" },
      });
      return data as unknown as string;
    } catch {
      return null;
    }
  };

  const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
    ...base,
    per_page: 100,
  });

  const entries: Entry[] = [];
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
    const content = await fetchFile(path);
    if (content == null) {
      entries.push({
        workflow: path,
        job: "*",
        status: "unknown",
        reason: "cannot fetch workflow file at head",
      });
      continue;
    }
    let wf: Workflow;
    try {
      wf = parseYaml(content);
    } catch (e) {
      entries.push({
        workflow: path,
        job: "*",
        status: "unknown",
        reason: `YAML parse error: ${e}`,
      });
      continue;
    }
    const [verdict, reason] = workflowDispatches(wf, ctx);
    if (verdict !== "dispatch") {
      entries.push({ workflow: path, job: "*", status: verdict, reason });
      continue;
    }
    for (const [jobName, status, jreason] of await expandJobs(wf, ctx, fetchFile)) {
      entries.push({ workflow: path, job: jobName, status, reason: jreason || reason });
    }
  }
  return { entries, skip: null };
}

// ------------------------------------------------------------------------ CLI

function parseArgs(argv: string[]): { repo: string; pr: number; json: boolean } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = get("--repo");
  const pr = get("--pr");
  if (!repo || !pr) {
    console.error("usage: predict --repo owner/name --pr N [--json]");
    process.exit(2);
  }
  return { repo, pr: Number(pr), json: argv.includes("--json") };
}

const isMain = /predict\.(ts|js)$|\/willrun$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { entries, skip } = await predict(makeOctokit(), args.repo, args.pr);
  if (args.json) {
    console.log(JSON.stringify({ entries, skip }, null, 2));
  } else if (skip) {
    console.log(`# ${skip} -> nothing dispatches`);
  } else {
    for (const e of entries) {
      if (e.job === "*") console.log(`# ${e.workflow} :: ${e.status} (${e.reason})`);
      else console.log(`${e.workflow} :: ${e.job} :: ${e.status}`);
    }
  }
}
