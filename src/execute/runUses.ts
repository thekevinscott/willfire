import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Scope } from "../expr/val.js";
import type { WorkflowSource } from "../types.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";
import { bindActionInputs } from "./bindActionInputs.js";
import { err } from "./err.js";
import { isCheckout } from "./isCheckout.js";
import { parseActionUses } from "./parseActionUses.js";
import { readActionManifest } from "./readActionManifest.js";
import { renderTemplate } from "./renderTemplate.js";
import { runNodeAction } from "./runNodeAction.js";
import { runSteps } from "./runSteps.js";
import type { ActionModel, Res, StepModel, WalkCtx } from "./types.js";

/** A cycle guard, not a fidelity claim — a self-including composite would recurse forever. */
const MAX_ACTION_DEPTH = 4;

const SETUP_NODE_RE = /^actions\/setup-node@/;

const SHA_RE = /^[0-9a-f]{40}$/i;

/** A `uses:` step: a runner-provided postcondition, an action to run, or a stop. */
export async function runUses(
  step: StepModel,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Promise<Res<Record<string, string>>> {
  const uses = step.uses as string;
  const withBlock: YamlMap = step.with ?? {};
  if (isCheckout(uses)) {
    // Runner-provided, and its postcondition — the head tree at the workspace
    // path — is already true. Any input beyond `fetch-depth: 0` asks for a
    // different tree than the one provided.
    const withKeys = Object.keys(withBlock);
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && String(withBlock["fetch-depth"]) === "0") {
      // Unmet inside a composite: the pre-scan that picks the tree provider
      // only reads the job's own steps.
      if (!ctx.hasHistory) {
        return err(`${label}: checkout wants history the workspace does not have`);
      }
      return { ok: true, v: {} };
    }
    return err(`${label}: actions/checkout with inputs is not modelled`);
  }
  if (SETUP_NODE_RE.test(uses)) {
    // The execution world ships exactly one node: asking for it is already
    // satisfied, asking for anything else cannot be. setup-node reads every
    // input through core.getInput, which trims and cannot tell an empty value
    // from an absent one, so an empty one asks for nothing.
    const withKeys = Object.entries(withBlock)
      .filter(([, raw]) => {
        const rendered = renderTemplate(String(raw ?? ""), scope);
        return rendered === null || rendered.trim() !== "";
      })
      .map(([k]) => k);
    if (withKeys.length === 0) {
      return { ok: true, v: {} };
    }
    if (withKeys.length === 1 && withKeys[0] === "node-version") {
      const wanted = renderTemplate(String(withBlock["node-version"]), scope);
      if (wanted === null) {
        return err(`${label}: cannot resolve node-version`);
      }
      const m = /^v?(\d+)(\..*)?$/.exec(wanted.trim());
      if (m !== null && Number(m[1]) === ctx.deps.nodeMajor) {
        return { ok: true, v: {} };
      }
      return err(
        `${label}: setup-node wants node ${wanted}; the sandbox has node ${ctx.deps.nodeMajor}`,
      );
    }
    return err(`${label}: setup-node with inputs beyond node-version is not modelled`);
  }
  if (ctx.depth + 1 > MAX_ACTION_DEPTH) {
    return err(`${label}: actions nested deeper than ${MAX_ACTION_DEPTH} levels`);
  }
  let actionDir: string;
  let actionRoot: string | undefined;
  if (uses.startsWith("./")) {
    actionDir = join(ctx.tree, uses);
  } else {
    const target = parseActionUses(uses);
    if (target === null) {
      return err(`${label}: unresolvable uses: ${uses}`);
    }
    const { ref } = target.source;
    const sha = SHA_RE.test(ref) ? ref : await ctx.deps.resolveRef(target.source);
    if (sha === null) {
      return err(`${label}: cannot resolve ref for ${uses}`);
    }
    const source: WorkflowSource = { ...target.source, sha };
    const root = await ctx.deps.provideTree(source);
    if (root === null) {
      return err(`${label}: cannot materialize ${source.owner}/${source.repo}@${sha}`);
    }
    actionDir = join(root, target.path);
    actionRoot = root;
  }
  const manifest = await readActionManifest(actionDir);
  if (manifest === null) {
    return err(`${label}: no action.yml under ${uses}`);
  }
  let action: ActionModel;
  try {
    action = parseYaml(manifest);
  } catch (e) {
    return err(`${label}: YAML parse error in ${uses}: ${e}`);
  }
  const using = action?.runs?.using;
  const nodeUsing = /^node(\d+)$/.exec(String(using));
  if (nodeUsing !== null) {
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
  if (action?.runs?.using !== "composite") {
    return err(
      `${label}: action ${uses} runs via '${using}'; only composite and node actions are executed`,
    );
  }
  const childScope: Scope = {
    inputs: bindActionInputs(action, step.with, scope),
    github: scope.github,
  };
  const walked = await runSteps(action.runs.steps ?? [], childScope, {
    ...ctx,
    actionPath: actionDir,
    actionRoot,
    depth: ctx.depth + 1,
  });
  if (!walked.ok) {
    return err(`${label} (${uses}): ${walked.reason}`);
  }
  // Every declared output must land; a partial map would be a lie.
  const outScope: Scope = { ...childScope, steps: walked.v };
  const outputs: Record<string, string> = {};
  for (const [name, decl] of Object.entries<YamlValue | undefined>(action.outputs ?? {})) {
    const raw = (decl as YamlMap | null)?.["value"];
    if (raw === null || raw === undefined) {
      return err(`${label}: output '${name}' of ${uses} has no value`);
    }
    const rendered = renderTemplate(String(raw), outScope);
    if (rendered === null) {
      return err(`${label}: cannot resolve output '${name}' of ${uses}`);
    }
    outputs[name] = rendered;
  }
  return { ok: true, v: outputs };
}
