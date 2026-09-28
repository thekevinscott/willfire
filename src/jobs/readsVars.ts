import type { Workflow } from "../types.js";

/**
 * Whether any of a workflow's jobs mention the `vars` context — the test that
 * decides if the repo's variables are worth an API read. Parsed YAML has
 * already dropped comments, so a stray match in a run script costs only that
 * one read.
 */
export const readsVars = (jobs: Record<string, Workflow>): boolean =>
  /\bvars\s*[.[]/.test(JSON.stringify(jobs));
