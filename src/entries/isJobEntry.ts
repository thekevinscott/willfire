import type { Entry, JobEntry } from "../types.js";

export const isJobEntry = (e: Entry): e is JobEntry => e.job !== "*";
