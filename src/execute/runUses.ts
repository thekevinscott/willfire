import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr/val.js";
import type { WorkflowSource } from "../types.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { err } from "./err.js";
import { parseActionUses } from "./parseActionUses.js";
import { readActionManifest } from "./readActionManifest.js";
import { renderTemplate } from "./renderTemplate.js";
import { runSteps } from "./runSteps.js";
import type { Res, WalkCtx } from "./types.js";

/**
 * A cycle guard, not a fidelity claim: a composite action that includes
 * itself would otherwise recurse forever. No granted job in practice nests
 * past one level.
 */
const MAX_ACTION_DEPTH = 4;

const CHECKOUT_RE = /^actions\/checkout@/;

const SHA_RE = /^[0-9a-f]{40}$/i;

/** A `uses:` step: checkout's postcondition, or a composite action, or a stop. */
export async function runUses(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses: string = step.uses;
  if (CHECKOUT_RE.test(uses)) {
    // Runner-provided, and its postcondition — the head tree at the workspace
    // path — is already true. But only the bare form: `ref:`, `path:`,
    // `repository:` each make it a different tree than the one provided.
    if (step.with != null && Object.keys(step.with).length > 0) {
      return err(`${label}: actions/checkout with inputs is not modelled`);
    }
    return { ok: true, v: {} };
  }
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  let actionDir: string;
  if (uses.startsWith("./")) {
    // Relative to the workspace, hermetic-style: the tree under test carries
    // the action. GitHub resolves it the same way.
    actionDir = join(ctx.tree, uses.slice(2));
  } else {
    const target = parseActionUses(uses);
    if (target == null) {
      return err(`${label}: unresolvable uses: ${uses}`);
    }
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha == null) {
      return err(`${label}: cannot resolve ref for ${uses}`);
    }
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root == null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = target.path === "" ? root : join(root, target.path);
  }
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
  if (using !== "composite") {
    // A JavaScript or Docker action is a program with its own runtime and its
    // own view of the world. Running one is a much larger promise than
    // running a shell step, and no granted job needs it.
    return err(`${label}: action ${uses} runs via '${using}'; only composite actions are executed`);
  }
  const childScope: Scope = {
    inputs: bindActionInputs(action, step.with, scope),
    github: scope.github,
  };
  const walked = await runSteps(action?.runs?.steps ?? [], childScope, {
    ...ctx,
    actionPath: actionDir,
    depth: ctx.depth + 1,
  });
  if (!walked.ok) {
    return err(`${label} (${uses}): ${walked.reason}`);
  }
  // The action's declared outputs are its whole surface: each `value:` is
  // evaluated against the child's own steps, and every one must land.
  const outScope: Scope = { ...childScope, steps: walked.v };
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries(action.outputs ?? {})) {
    const raw = (decl as Record<string, unknown> | null)?.["value"];
    if (raw == null) {
      return err(`${label}: output '${name}' of ${uses} has no value`);
    }
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered == null) {
      return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    }
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}
