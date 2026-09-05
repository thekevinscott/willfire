import { evaluate } from "../expr/evaluate.js";
import type { Scope } from "../expr/val.js";
import { err } from "./err.js";
import { runRun } from "./runRun.js";
import { runUses } from "./runUses.js";
import type { Res, StepModel, WalkCtx } from "./types.js";

export async function runSteps(
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
