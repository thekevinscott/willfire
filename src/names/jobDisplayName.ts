import { matrixSuffix } from "../matrix/matrixSuffix.js";
import { capDisplayName } from "./capDisplayName.js";
import { renderName } from "./renderName.js";
import type { DetailedCombo, DisplayName, Workflow } from "../types.js";

/**
 * A `name:` that contains any `${{ }}` expression suppresses the matrix
 * parenthetical; a literal one does not.
 *
 * Probe-verified three ways over `a: [x, y]`: `name: Static Label` yields
 * `Static Label (x)` / `Static Label (y)`, `name: ev ${{ github.event_name }}`
 * yields two checks both called `ev pull_request`, and
 * `name: p ${{ matrix.a }}` over `a: [x], b: ["1", "2"]` yields two checks
 * both called `p x`. So the trigger is the presence of an expression, not
 * whether the expression happens to read the matrix — and duplicate check
 * names are a real outcome GitHub allows.
 */
export const EXPRESSION_RE = /\$\{\{/;

/** The check name for one job/combination. */
export function jobDisplayName(
  jobId: string,
  job: Workflow,
  combo: DetailedCombo | null,
): DisplayName {
  const raw = job.name !== undefined && job.name !== null ? String(job.name) : null;
  if (raw === null) {
    return { name: capDisplayName(jobId + (combo ? matrixSuffix(combo) : "")), resolved: true };
  }
  const { text, resolved } = renderName(raw, combo?.values ?? null);
  const suffix = combo && !EXPRESSION_RE.test(raw) ? matrixSuffix(combo) : "";
  return { name: capDisplayName(text + suffix), resolved };
}
