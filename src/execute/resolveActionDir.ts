import { join } from "node:path";
import type { WorkflowSource } from "../types.js";
import { parseActionUses } from "./parseActionUses.js";
import { err, type Res } from "./result.js";
import type { WalkCtx } from "./walkCtx.js";

/** `ref` is already a commit id, so resolving it is a no-op. */
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface ActionDir {
  actionDir: string;
  /** The materialized tree root, when the action came from another repo. */
  actionRoot?: string;
}

/** Where an action's files live: inside the workspace tree, or a materialized repo. */
export async function resolveActionDir(
  uses: string,
  label: string,
  ctx: WalkCtx,
): Promise<Res<ActionDir>> {
  if (uses.startsWith("./")) {
    return { ok: true, v: { actionDir: join(ctx.tree, uses.slice(2)) } };
  }
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
  return {
    ok: true,
    v: { actionDir: target.path === "" ? root : join(root, target.path), actionRoot: root },
  };
}
