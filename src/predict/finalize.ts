import type { DraftEntry, DraftWorkflowEntry, Entry } from "../types.js";

const isWorkflowDraft = (e: DraftEntry): e is DraftWorkflowEntry => e.job === "*";

export const finalize = (e: DraftEntry): Entry =>
  isWorkflowDraft(e)
    ? { ...e, checkName: null }
    : { ...e, checkName: e.checkName ?? null };
