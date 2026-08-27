import { parse as parseYaml } from "yaml";
import { evaluateValue } from "../expr/evaluateValue.js";
import { UNKNOWN, type Scope, type Val } from "../expr/val.js";
import { renderTemplate, type JobExecutor } from "../execute.js";
import { expandMatrixDetailed } from "../matrix/expandMatrixDetailed.js";
import { jobDisplayName } from "../names/jobDisplayName.js";
import { skippedDisplayName } from "../names/skippedDisplayName.js";
import { parseUses } from "../uses/parseUses.js";
import { evalIf } from "./evalIf.js";
import { prScope } from "./prScope.js";
import type {
  Ctx,
  ExpandedJob,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

/**
 * A `with:` value as the callee will see it, evaluated in the caller's scope.
 * A whole-expression value keeps its evaluated type; mixed text renders to a
 * string, all or nothing; anything unresolvable stays unknown.
 */
function inputValue(raw: unknown, scope: Scope): Val {
  if (raw === null || raw === undefined) {
    return { kind: "value", v: "" };
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return { kind: "value", v: raw };
  }
  if (typeof raw !== "string") {
    return UNKNOWN;
  }
  if (!raw.includes("${{")) {
    return { kind: "value", v: raw };
  }
  const t = raw.trim();
  // `${{a}} x ${{b}}` fails this test and takes the render path instead.
  if (t.startsWith("${{") && t.indexOf("}}") === t.length - 2) {
    return evaluateValue(t.slice(3, -2), prScope(scope));
  }
  const rendered = renderTemplate(raw, prScope(scope));
  return rendered === null ? UNKNOWN : { kind: "value", v: rendered };
}

/** The `on.workflow_call.inputs` block, tolerating the YAML 1.1 `on` -> true key. */
function workflowCallInputs(wf: Workflow): Record<string, any> {
  const on = wf?.["on"] ?? wf?.["true"];
  if (on === null || typeof on !== "object") {
    return {};
  }
  const call = (on as Record<string, any>)["workflow_call"];
  if (call === null || typeof call !== "object") {
    return {};
  }
  const inputs = call["inputs"];
  return inputs !== null && typeof inputs === "object" ? inputs : {};
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
function calleeInputs(
  withBlock: unknown,
  subWf: Workflow,
  scope: Scope,
): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, decl] of Object.entries(workflowCallInputs(subWf))) {
    out[name] =
      decl !== null && typeof decl === "object" && "default" in decl
        ? // Defaults live in the callee, out of the caller's context's reach.
          inputValue((decl as Record<string, unknown>)["default"], {})
        : UNKNOWN;
  }
  if (withBlock !== null && typeof withBlock === "object") {
    for (const [name, raw] of Object.entries(withBlock as Record<string, unknown>)) {
      out[name] = inputValue(raw, scope);
    }
  }
  return out;
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

/** `ref` is already a commit id, so resolving it is a no-op. */
const SHA_RE = /^[0-9a-f]{40}$/i;

const isSha = (ref: string): boolean => SHA_RE.test(ref);

const NEEDS_OUTPUTS_RE = /needs\s*\.\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\.\s*outputs\b/g;

/**
 * The jobs some sibling reads outputs from — the only jobs worth executing.
 * Matching over the serialized job catches every read site without modelling
 * any; a false positive costs one wasted run, never a verdict.
 */
function neededJobIds(jobs: Record<string, Workflow>): Set<string> {
  const needed = new Set<string>();
  for (const job of Object.values(jobs)) {
    for (const m of JSON.stringify(job ?? {}).matchAll(NEEDS_OUTPUTS_RE)) {
      needed.add(m[1]);
    }
  }
  return needed;
}

export async function expandJobs(
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

  // Selection is derived, never configured: execute exactly the jobs some
  // sibling's `needs.*.outputs` read depends on, under the same `evalIf`
  // verdict the main loop applies.
  let scoped = scope;
  const execFailures: Record<string, string> = {};
  if (executor !== undefined) {
    const needed = neededJobIds(jobs);
    for (const [jobId, jobRaw] of Object.entries(jobs)) {
      const job = jobRaw ?? {};
      // A reusable-call job has no steps of its own to run.
      const runnable =
        needed.has(jobId) && !("uses" in job) && evalIf(job.if, scoped) === "run";
      if (runnable) {
        const res = await executor.executeJob(jobId, job, wf, scoped);
        if (res.ok) {
          scoped = { ...scoped, needs: { ...scoped.needs, [jobId]: { outputs: res.outputs } } };
        } else {
          execFailures[jobId] = res.reason;
        }
      }
    }
  }
  const execNote = (needs: string[]): string => {
    const failed = needs.find((n) => n in execFailures);
    return failed === undefined ? "" : `; executing '${failed}' failed: ${execFailures[failed]}`;
  };

  for (const [jobId, jobRaw] of Object.entries(jobs)) {
    const job = jobRaw ?? {};
    let status = evalIf(job.if, scoped);
    let reason = job.if !== undefined && job.if !== null ? `if: ${JSON.stringify(job.if)}` : "";
    let needs: string[] = job.needs ?? [];
    if (typeof needs === "string") {
      needs = [needs];
    }
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
    } else if ("uses" in job) {
      // Reusable workflow call. The calling job produces no check of its own;
      // each called job becomes `<calling job name> / <called job name>`, and
      // a matrix on the *caller* multiplies the whole callee set. A cross-repo
      // call names its checks exactly the same way a local one does — probe
      // PR #9, `call-remote-tag / r-inner` alongside `call-plain / inner`.
      const combos = expandMatrixDetailed(job.strategy, prScope(scoped));
      const uses: string = job.uses;
      if (combos === null) {
        entries.push({
          job: prefix + jobId,
          checkName: null,
          status: "unknown",
          reason: "dynamic matrix on reusable workflow call" + execNote(needs),
        });
      } else {
        // Resolve the called workflow once, not once per matrix combination.
        let subWf: Workflow | null = null;
        let failure: string | null = null;
        // Where the callee's own `./` calls will resolve. A remote `uses:`
        // moves this to the callee's repo and pinned ref; a local one leaves
        // it alone.
        let subSource: WorkflowSource = source;
        // What `inputs.*` means on the other side of the call.
        let subScope: Scope = {};
        const target = parseUses(uses);
        if (depth + 1 > MAX_REUSABLE_DEPTH) {
          failure = `reusable workflow nested deeper than ${MAX_REUSABLE_DEPTH} levels`;
        } else if (target === null) {
          failure = `unresolvable reusable reference: ${uses}`;
        } else {
          // A local `./` call stays on the caller's source, which is already
          // pinned to a commit. A cross-repo one arrives as whatever the
          // `uses:` string spelled — `@v0` — and has to be resolved before
          // anything is read from it, so the file that gets read and the
          // commit the prediction names are the same one.
          let resolved: WorkflowSource | null = source;
          if (target.source !== null) {
            const { ref } = target.source;
            const sha = isSha(ref) ? ref : await reader.resolveRef(target.source);
            resolved = sha === null ? null : { ...target.source, sha };
          }
          if (resolved === null) {
            failure = `cannot resolve ref for ${uses}`;
          } else {
            subSource = resolved;
            const content = await reader.fetchWorkflow(target.path, subSource);
            if (content === null) {
              failure = `cannot fetch ${uses}`;
            } else {
              try {
                subWf = parseYaml(content);
                // `inputs.*` changes at the call boundary; `github.*` does
                // not. A callee's jobs run in the caller's repo, so the facts
                // seeded at the top of the prediction stay true all the way
                // down.
                subScope = {
                  inputs: calleeInputs(job.with, subWf ?? {}, scoped),
                  github: scoped.github,
                };
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
          if (failure !== null || subWf === null) {
            entries.push({
              job: baseName,
              checkName: null,
              status: "unknown",
              reason: failure ?? `cannot resolve ${uses}`,
            });
          } else {
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
        }
      }
    } else {
      const combos = expandMatrixDetailed(job.strategy, prScope(scoped));
      if (combos === null) {
        entries.push({
          job: prefix + jobId,
          checkName: null,
          status: "unknown",
          reason: "dynamic matrix" + execNote(needs),
        });
      } else {
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
    }
  }
  return entries;
}
