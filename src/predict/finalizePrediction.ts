import { finalize } from "./finalize.js";
import { sourceKey } from "./sourceKey.js";
import type { DraftEntry, Prediction, WorkflowSource } from "../types.js";

export function finalizePrediction(
  entries: DraftEntry[],
  skip: string | null,
  sources: Map<string, WorkflowSource>,
): Prediction {
  const final = entries.map(finalize);
  // Not deduplicated: two matrix combinations whose `name:` does not vary per
  // combination collapse to one string and GitHub creates a check for each
  // (run 36430883584).
  const names: string[] = [];
  for (const e of final) {
    if ((e.status === "run" || e.status === "skipped") && e.checkName !== null) {
      names.push(e.checkName);
    }
  }
  return {
    entries: final,
    checkNames: names.sort(),
    skip,
    sources: [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
  };
}
