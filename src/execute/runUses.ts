import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr.js";
import type { WorkflowSource } from "../types.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { parseActionUses } from "./parseActionUses.js";
import { readActionManifest } from "./readActionManifest.js";
import { renderTemplate } from "./renderTemplate.js";
import { err, type Res } from "./result.js";
import { runCheckout } from "./runCheckout.js";
import { runNodeAction } from "./runNodeAction.js";
import { runSetupNode } from "./runSetupNode.js";
import { runSteps } from "./runSteps.js";
import { CHECKOUT_RE, MAX_ACTION_DEPTH, SETUP_NODE_RE, type WalkCtx } from "./walkCtx.js";

/** `ref` is already a commit id, so resolving it is a no-op. */
const SHA_RE = /^[0-9a-f]{40}$/i;

/** A `uses:` step: a runner-provided postcondition, an action to run, or a stop. */
export async function runUses(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses: string = step.uses;
  if (CHECKOUT_RE.test(uses)) return runCheckout(step, label, ctx);
  if (SETUP_NODE_RE.test(uses)) return runSetupNode(step, label, scope, ctx);
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  let actionDir: string;
  let actionRoot: string | undefined;
  if (uses.startsWith("./")) {
    actionDir = join(ctx.tree, uses.slice(2));
  } else {
    const target = parseActionUses(uses);
    if (target == null) return err(`${label}: unresolvable uses: ${uses}`);
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha == null) return err(`${label}: cannot resolve ref for ${uses}`);
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root == null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = target.path === "" ? root : join(root, target.path);
    actionRoot = root;
  }
  const manifest = await readActionManifest(actionDir);
  if (manifest == null) return err(`${label}: no action.yml under ${uses}`);
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
  if (!walked.ok) return err(`${label} (${uses}): ${walked.reason}`);
  // Every declared output must land; a partial map would be a lie.
  const outScope: Scope = { ...childScope, steps: walked.v };
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries(action.outputs ?? {})) {
    const raw = (decl as Record<string, unknown> | null)?.["value"];
    if (raw == null) return err(`${label}: output '${name}' of ${uses} has no value`);
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered == null) return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}
