import { expandMatrixDetailed } from "./expandMatrixDetailed.js";
import type { Scope } from "../expr.js";
import type { Combo } from "../types.js";

/** Return list of matrix combination dicts, or null if dynamic. */
export function expandMatrix(strategy: any, scope: Scope = {}): Combo[] | null {
  const detailed = expandMatrixDetailed(strategy, scope);
  return detailed == null ? null : detailed.map((c) => (c == null ? null : c.values));
}
