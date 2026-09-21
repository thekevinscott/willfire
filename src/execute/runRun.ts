import { resolve } from "node:path";
import type { Scope } from "../expr/val.js";
import { err } from "./err.js";
import { outputSink } from "./outputSink.js";
import { renderTemplate } from "./renderTemplate.js";
import { stepEnv } from "./stepEnv.js";
import { stepOutcome } from "./stepOutcome.js";
import type { Res, StepModel, WalkCtx } from "./types.js";

/** A `run:` step, executed under its declared shell with its declared env. */
export async function runRun(
  step: StepModel,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const shell = step.shell === null || step.shell === undefined ? "bash" : String(step.shell);
  if (shell !== "bash" && shell !== "sh") {
    return err(`${label}: shell '${shell}' is not modelled`);
  }
  const script = renderTemplate(String(step.run), scope);
  if (script === null) {
    return err(`${label}: cannot resolve \${{ }} in run`);
  }
  const built = stepEnv(
    step,
    scope,
    ctx,
    label,
    ctx.actionPath === undefined ? {} : { GITHUB_ACTION_PATH: ctx.actionPath },
  );
  if (!built.ok) {
    return built;
  }
  const env = built.v;
  let cwd = ctx.tree;
  if (step["working-directory"] !== undefined && step["working-directory"] !== null) {
    const wd = renderTemplate(String(step["working-directory"]), scope);
    if (wd === null) {
      return err(`${label}: cannot resolve working-directory`);
    }
    cwd = resolve(ctx.tree, wd);
  }
  const sink = await outputSink(env);
  try {
    const r = await ctx.deps.runCommand({
      script,
      shell,
      cwd,
      env,
      mounts: [
        { path: ctx.tree, writable: true },
        ...(ctx.actionRoot !== undefined ? [{ path: ctx.actionRoot, writable: false }] : []),
        { path: sink.dir, writable: true },
      ],
    });
    return await stepOutcome(r, sink.file, label);
  } finally {
    await sink.remove();
  }
}
