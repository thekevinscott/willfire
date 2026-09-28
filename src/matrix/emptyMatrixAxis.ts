import { emptyAxisOf } from "./emptyAxisOf.js";
import type { Workflow } from "../types.js";

/**
 * The name of the first matrix axis written as a literal empty list, or null.
 *
 * GitHub rejects the whole workflow file at startup for one of these: probe PR
 * #372's `probe-m1.yml` paired `a: []` with a plain sibling job, and run
 * 36431252913 concluded with zero jobs — no `pull_request` run existed at all,
 * so the sibling got no check either. An axis that is an *expression* resolving
 * to `[]` is a different case: that one is evaluated at run time and cancels
 * only its own job (run 36430084611).
 */
export function emptyMatrixAxis(wf: Workflow): string | null {
  const jobs = (wf["jobs"] ?? {}) as Record<string, Workflow | null>;
  for (const job of Object.values(jobs)) {
    const axis = emptyAxisOf(job ?? {});
    if (axis !== null) {
      return axis;
    }
  }
  return null;
}
