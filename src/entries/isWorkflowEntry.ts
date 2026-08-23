import type { Entry, WorkflowEntry } from "../types.js";

/** Narrow to the workflow-level variant without inspecting the sentinel. */
export const isWorkflowEntry = (e: Entry): e is WorkflowEntry => e.job === "*";
