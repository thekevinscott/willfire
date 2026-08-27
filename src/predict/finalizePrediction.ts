import { sourceKey } from "./sourceKey.js";
import type {
  DraftEntry,
  DraftWorkflowEntry,
  Entry,
  Prediction,
  WorkflowSource,
} from "../types.js";

const isWorkflowDraft = (e: DraftEntry): e is DraftWorkflowEntry => e.job === "*";

const finalize = (e: DraftEntry): Entry =>
  isWorkflowDraft(e)
    ? { ...e, checkName: null }
    : { ...e, checkName: e.checkName ?? null };

export function finalizePrediction(
  entries: DraftEntry[],
  skip: string | null,
  sources: Map<string, WorkflowSource>,
): Prediction {
  const final = entries.map(finalize);
  const names = new Set<string>();
  for (const e of final) {
    if (e.status === "run" && e.checkName != null) {
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
