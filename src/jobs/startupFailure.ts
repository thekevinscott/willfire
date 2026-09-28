// GitHub builds a workflow's whole reusable call graph before it schedules
// anything, so a `uses:` it cannot read fails the run at startup: the run
// exists and concludes `failure` with zero jobs, the broken call's siblings
// included. Measured on probe PR #369 — runs 36429562730 (cross-repo callee in
// a repo that does not exist) and 36429562502 (local callee file absent), both
// `failure`, both `total_count: 0`, each alongside two ordinary sibling jobs.

export interface StartupFailure extends Error {
  readonly startupFailure: true;
}

// Declared, not an arrow const: the mutation gate cannot attribute per-test
// coverage to an arrow const and reports its mutants as survivors.
export function startupFailure(message: string): StartupFailure {
  return Object.assign(new Error(message), { startupFailure: true as const });
}
