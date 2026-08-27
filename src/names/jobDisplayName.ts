import { matrixSuffix } from "../matrix/matrixSuffix.js";
import { renderName } from "./renderName.js";
import type { DetailedCombo, DisplayName, Workflow } from "../types.js";

export const EXPRESSION_RE = /\$\{\{/;

export function jobDisplayName(
  jobId: string,
  job: Workflow,
  combo: DetailedCombo | null,
): DisplayName {
  const raw = job != null && job.name != null ? String(job.name) : null;
  if (raw === null) {
    return { name: jobId + (combo ? matrixSuffix(combo) : ""), resolved: true };
  }
  const { text, resolved } = renderName(raw, combo?.values ?? null);
  const suffix = combo && !EXPRESSION_RE.test(raw) ? matrixSuffix(combo) : "";
  return { name: text + suffix, resolved };
}
