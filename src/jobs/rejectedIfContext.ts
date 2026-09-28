import { rejectedIn } from "./rejectedIn.js";
import type { Workflow } from "../types.js";
import type { YamlValue } from "../yamlValue.js";

const isMap = (v: YamlValue | undefined): v is Workflow => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The reason GitHub fails this workflow file at startup, or null when no `if:`
 * in it reads a context GitHub refuses there.
 *
 * Whole-file, not per-job: the startup failure hangs off the push that
 * introduced the file and carries no jobs, so a valid sibling job in the same
 * file gets no check either.
 */
export function rejectedIfContext(wf: Workflow): string | null {
  const jobs = (wf["jobs"] ?? {}) as Record<string, YamlValue | undefined>;
  const declared = Object.entries(jobs).filter((e): e is [string, Workflow] => isMap(e[1]));
  for (const [id, job] of declared) {
    const jobCtx = rejectedIn(job["if"], "job");
    if (jobCtx !== null) {
      return `job '${id}' if: reads ${jobCtx}, unavailable there: startup failure`;
    }
    const steps = job["steps"];
    for (const step of Array.isArray(steps) ? steps.filter(isMap) : []) {
      const stepCtx = rejectedIn(step["if"], "step");
      if (stepCtx !== null) {
        return `a step of job '${id}' if: reads ${stepCtx}, unavailable there: startup failure`;
      }
    }
  }
  return null;
}
