import type { Entry, JobEntry } from "../types.js";

/** Narrow to the job-level variant without inspecting the sentinel. */
export const isJobEntry = (e: Entry): e is JobEntry => e.job !== "*";
