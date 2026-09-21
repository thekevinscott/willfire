import { join } from "node:path";
import type { Scope } from "../expr/val.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { err } from "./err.js";
import { runStepCommand } from "./runStepCommand.js";
import { stepEnv } from "./stepEnv.js";
import type { ActionModel, Res, StepModel, WalkCtx } from "./types.js";

/**
 * `node <main>` with inputs bound as `INPUT_*` env vars. What lands in
 * `$GITHUB_OUTPUT` is the whole output surface — a node action's manifest
 * `outputs:` block is documentation, not a mapping.
 */
export async function runNodeAction(
  step: StepModel,
  label: string,
  uses: string,
  action: ActionModel | null,
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
  const built = stepEnv(step, scope, ctx, label);
  if (!built.ok) {
    return built;
  }
  const env = built.v;
  // Unlike a composite's, a node action's input reads are opaque, so every
  // binding must be concrete up front.
  for (const [name, val] of Object.entries(bindActionInputs(action, step.with, scope))) {
    if (val.kind !== "value") {
      return err(`${label}: cannot resolve input '${name}' of ${uses}`);
    }
    env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] = String(val.v);
  }
  // After the layers, so no `env:` block can point the runner at another file.
  env.WILLFIRE_ACTION_MAIN = join(actionDir, main);
  return await runStepCommand({
    runCommand: ctx.deps.runCommand,
    script: 'exec node "$WILLFIRE_ACTION_MAIN"',
    shell: "bash",
    cwd: ctx.tree,
    env,
    tree: ctx.tree,
    actionRoot,
    label,
  });
}
