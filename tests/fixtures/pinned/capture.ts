/** One check GitHub actually created for the pinned dispatch. */
export interface DispatchedCheck {
  workflow: string;
  name: string;
  conclusion: string | null;
}

/** One pinned PR: the dispatch GitHub produced, and the commits it produced it from. */
export interface E2ECapture {
  repo: string;
  pr: number;
  /** Both commits, because prediction reads at the merge commit and falls back to head. */
  commits: { head: string; merge: string | null };
  /** Ground truth: every check the dispatch created, skipped ones included. */
  dispatched: DispatchedCheck[];
}
