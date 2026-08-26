import type { Scope } from "../expr/val.js";
import { renderTemplate } from "./renderTemplate.js";
import { err, type Res } from "./result.js";
import type { WalkCtx } from "./walkCtx.js";

/**
 * The execution world ships exactly one node: asking for it is already
 * satisfied, asking for anything else cannot be.
 */
export function runSetupNode(
  step: any,
  label: string,
  scope: Scope,
  ctx: WalkCtx,
): Res<Record<string, string>> {
  const withKeys = step.with == null ? [] : Object.keys(step.with);
  if (withKeys.length === 0) {
    return { ok: true, v: {} };
  }
  if (withKeys.length === 1 && withKeys[0] === "node-version") {
    const wanted = renderTemplate(String(step.with["node-version"]), scope);
    if (wanted == null) {
      return err(`${label}: cannot resolve node-version`);
    }
    const m = /^v?(\d+)(\..*)?$/.exec(wanted.trim());
    if (m != null && Number(m[1]) === ctx.deps.nodeMajor) {
      return { ok: true, v: {} };
    }
    return err(
      `${label}: setup-node wants node ${wanted}; the sandbox has node ${ctx.deps.nodeMajor}`,
    );
  }
  return err(`${label}: setup-node with inputs beyond node-version is not modelled`);
}
