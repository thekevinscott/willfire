import { matchFilters } from "../filters/matchFilters.js";
import { getPrTrigger, MISSING } from "./getPrTrigger.js";
import type { Ctx, Workflow } from "../types.js";

const DEFAULT_TYPES = ["opened", "synchronize", "reopened"];

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

  if ("branches" in trig && "branches-ignore" in trig) {
    return [true, "both branches and branches-ignore set: startup failure"];
  }
  const branchRef = ctx.stackTarget ?? ctx.baseRef;
  if ("branches" in trig && !matchFilters(branchRef, trig["branches"])) {
    const label = ctx.stackTarget == null ? "base branch" : "stack target";
    return [false, `${label} '${branchRef}' not in branches`];
  }
  if ("branches-ignore" in trig && matchFilters(branchRef, trig["branches-ignore"])) {
    return [
      false,
      ctx.stackTarget == null
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
