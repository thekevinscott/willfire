import { isPlainObject } from "../callback/isPlainObject.js";
import { rejectedIn } from "./rejectedIn.js";
import type { Workflow } from "../types.js";
import type { YamlValue } from "../yamlValue.js";

/**
 * The reason GitHub fails this workflow file at startup, or null when no `if:`
 * in it reads a context GitHub refuses there.
 *
 * Whole-file, not per-job: the startup failure hangs off the push that
 * introduced the file and carries no jobs, so a valid sibling job in the same
 * file gets no check either.
 *
 * The refused names are measured on willfire#409 (head `f3c21dc`): `secrets`
 * in a job `if:` wrapped (run 36433479173) and bare (36433480515), `secrets`
 * in a step `if:` (36433481828), and `env` in a job `if:` (36433483413) each
 * produced only a zero-job `push` failure run and no `pull_request` run at
 * all. A step may read `env`; a job may not.
 */
export function rejectedIfContext(wf: Workflow): string | null {
  const jobs = (wf["jobs"] ?? {}) as Record<string, YamlValue | undefined>;
  const declared = Object.entries(jobs).filter((e): e is [string, Workflow] => isPlainObject(e[1]));
  for (const [id, job] of declared) {
    const jobCtx = rejectedIn(job["if"], ["secrets", "env"]);
    if (jobCtx !== null) {
      return `job '${id}' if: reads ${jobCtx}, unavailable there: startup failure`;
    }
    const steps = [job["steps"]].flat().filter((s): s is Workflow => isPlainObject(s));
    for (const step of steps) {
      const stepCtx = rejectedIn(step["if"], ["secrets"]);
      if (stepCtx !== null) {
        return `a step of job '${id}' if: reads ${stepCtx}, unavailable there: startup failure`;
      }
    }
  }
  return null;
}
