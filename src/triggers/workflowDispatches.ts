import { matchFilters } from "../filters/matchFilters.js";
import { getPrTrigger, MISSING } from "./getPrTrigger.js";
import type { Ctx, Workflow } from "../types.js";

const DEFAULT_TYPES = ["opened", "synchronize", "reopened"];

// A predicate: does this workflow produce a run for the PR? Every workflow-level
// verdict is decidable, so there is no third answer to express. Only job
// expansion can be genuinely undecidable (dynamic matrix, an unreadable
// reusable workflow, unresolvable `if`), and that is a per-entry status.
export function workflowDispatches(
  wf: Workflow,
  ctx: Ctx,
): [dispatches: boolean, reason: string] {
  const trig = getPrTrigger(wf);
  if (trig === MISSING) {
    return [false, "no pull_request trigger"];
  }

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
  const branchRef = ctx.stackTarget ?? ctx.baseRef;
  if ("branches" in trig && !matchFilters(branchRef, trig["branches"])) {
    const label = ctx.stackTarget === undefined ? "base branch" : "stack target";
    return [false, `${label} '${branchRef}' not in branches`];
  }
  if ("branches-ignore" in trig && matchFilters(branchRef, trig["branches-ignore"])) {
    return [
      false,
      ctx.stackTarget === undefined
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
