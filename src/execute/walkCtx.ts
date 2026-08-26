import type { ExecDeps } from "./types.js";

/** A cycle guard, not a fidelity claim — a self-including composite would recurse forever. */
export const MAX_ACTION_DEPTH = 4;

export const CHECKOUT_RE = /^actions\/checkout@/;

export const SETUP_NODE_RE = /^actions\/setup-node@/;

export interface WalkCtx {
  /** Workspace root: the PR head tree, where every step runs by default. */
  tree: string;
  /** Whether that tree carries its full git history (a clone, not a tarball). */
  hasHistory: boolean;
  /** Set inside a composite action — where `$GITHUB_ACTION_PATH` points. */
  actionPath?: string;
  /**
   * The whole materialized repo a remote action came from. A real runner
   * checks out the action's repo, not its `uses:` subdirectory, and actions do
   * reach past their own dir — so this, not `actionPath`, is the mount unit.
   */
  actionRoot?: string;
  /** Raw `env:` blocks from enclosing scopes, outermost first. */
  envLayers: unknown[];
  deps: ExecDeps;
  depth: number;
}
