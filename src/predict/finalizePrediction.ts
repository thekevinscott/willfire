import { finalize } from "./finalize.js";
import { sourceKey } from "./sourceKey.js";
import type { DraftEntry, Prediction, WorkflowSource } from "../types.js";

export function finalizePrediction(
  entries: DraftEntry[],
  skip: string | null,
  sources: Map<string, WorkflowSource>,
): Prediction {
  const final = entries.map(finalize);
  const names = new Set<string>();
  for (const e of final) {
    // Not gated on status: GitHub creates the check whether the job runs or
    // skips, so a resolved name is a check either way. `checkName` is already
    // null for every entry whose check may not exist at all.
    if (e.checkName !== null) {
      names.add(e.checkName);
    }
  }
  return {
    entries: final,
    checkNames: [...names].sort(),
    skip,
    sources: [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
  };
}
