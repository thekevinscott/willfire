import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr/val.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { compositeOutputs } from "./compositeOutputs.js";
import { readActionManifest } from "./readActionManifest.js";
import { resolveActionDir } from "./resolveActionDir.js";
import { err, type Res } from "./result.js";
import { runCheckout } from "./runCheckout.js";
import { runNodeAction } from "./runNodeAction.js";
import { runSetupNode } from "./runSetupNode.js";
import { runSteps } from "./runSteps.js";
import { CHECKOUT_RE, MAX_ACTION_DEPTH, SETUP_NODE_RE, type WalkCtx } from "./walkCtx.js";

/** A `uses:` step: a runner-provided postcondition, an action to run, or a stop. */
export async function runUses(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses: string = step.uses;
  if (CHECKOUT_RE.test(uses)) {
    return runCheckout(step, label, ctx);
  }
  if (SETUP_NODE_RE.test(uses)) {
    return runSetupNode(step, label, scope, ctx);
  }
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  const dir = await resolveActionDir(uses, label, ctx);
  if (!dir.ok) {
    return dir;
  }
  const { actionDir, actionRoot } = dir.v;
  const manifest = await readActionManifest(actionDir);
  if (manifest == null) {
    return err(`${label}: no action.yml under ${uses}`);
  }
  let action: any;
  try {
    action = parseYaml(manifest);
  } catch (e) {
    return err(`${label}: YAML parse error in ${uses}: ${e}`);
  }
  const using = action?.runs?.using;
  const nodeUsing = /^node(\d+)$/.exec(String(using));
  if (nodeUsing != null) {
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
  return compositeOutputs(action, uses, label, { ...childScope, steps: walked.v });
}
