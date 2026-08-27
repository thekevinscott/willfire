import { expandMatrixDetailed } from "./expandMatrixDetailed.js";
import type { Scope } from "../expr/val.js";
import type { Combo } from "../types.js";

export function expandMatrix(strategy: any, scope: Scope = {}): Combo[] | null {
  const detailed = expandMatrixDetailed(strategy, scope);
  return detailed == null ? null : detailed.map((c) => (c == null ? null : c.values));
}
