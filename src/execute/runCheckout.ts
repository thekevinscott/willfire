import { err, type Res } from "./result.js";
import type { WalkCtx } from "./walkCtx.js";

/**
 * Runner-provided, and its postcondition — the head tree at the workspace
 * path — is already true. Any input beyond `fetch-depth: 0` asks for a
 * different tree than the one provided.
 */
export function runCheckout(
  step: any,
  label: string,
  ctx: WalkCtx,
): Res<Record<string, string>> {
  const withKeys = step.with == null ? [] : Object.keys(step.with);
  if (withKeys.length === 0) return { ok: true, v: {} };
  if (withKeys.length === 1 && String(step.with["fetch-depth"]) === "0") {
    // Unmet inside a composite: the pre-scan that picks the tree provider
    // only reads the job's own steps.
    if (!ctx.hasHistory) {
      return err(`${label}: checkout wants history the workspace does not have`);
    }
    return { ok: true, v: {} };
  }
  return err(`${label}: actions/checkout with inputs is not modelled`);
}
