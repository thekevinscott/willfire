import type { Entry, WorkflowEntry } from "../types.js";

export const isWorkflowEntry = (e: Entry): e is WorkflowEntry => e.job === "*";
