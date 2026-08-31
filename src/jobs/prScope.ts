import type { Scope } from "../expr/val.js";

/**
 * `predict` only ever answers for a pull request, so `event_name` is fixed —
 * which is what lets a `github.event_name == 'pull_request'` guard resolve
 * instead of hanging the job on an unknown.
 */
const PR_GITHUB_CONTEXT: Record<string, string> = { event_name: "pull_request" };

/** Anything the caller states wins over the defaults. */
export const prScope = (scope: Scope): Scope => ({
  ...scope,
  github: { ...PR_GITHUB_CONTEXT, ...scope.github },
});
