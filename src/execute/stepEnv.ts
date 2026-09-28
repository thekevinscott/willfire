import type { Scope } from "../expr/val.js";
import { err } from "./err.js";
import { renderEnvLayer } from "./renderEnvLayer.js";
import type { Res, StepModel, WalkCtx } from "./types.js";

/**
 * The env a step runs under: what every step sees, then the caller's own keys,
 * then each `env:` layer rendered over both — a step's `env:` outranks them.
 */
export function stepEnv(
  step: StepModel,
  scope: Scope,
  ctx: WalkCtx,
  label: string,
  pre: Record<string, string> = {},
): Res<Record<string, string>> {
  const env: Record<string, string> = {
    // Everything else a step sees, it declared. A sandboxed runner swaps PATH
    // and HOME for its own.
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GITHUB_WORKSPACE: ctx.tree,
  };
  if (scope.github?.repository !== undefined) {
    env.GITHUB_REPOSITORY = scope.github.repository;
  }
  if (scope.github?.event_name !== undefined) {
    env.GITHUB_EVENT_NAME = scope.github.event_name;
  }
  Object.assign(env, pre);
  for (const layer of ctx.envLayers) {
    const rendered = renderEnvLayer(layer, scope);
    if (!rendered.ok) {
      return err(`${label}: ${rendered.reason}`);
    }
    Object.assign(env, rendered.v);
  }
  // $GITHUB_ENV writes outrank the file's env: blocks; the step's own env:
  // still wins, as on a runner.
  Object.assign(env, ctx.jobEnv);
  const own = renderEnvLayer(step.env, scope);
  if (!own.ok) {
    return err(`${label}: ${own.reason}`);
  }
  Object.assign(env, own.v);
  return { ok: true, v: env };
}
