import type { Scope } from "../expr.js";

/**
 * The `github.*` values that are fixed for everything this module predicts.
 * `predict` only ever answers for a pull request, so `event_name` is not a
 * variable — which is what lets a `github.event_name == 'pull_request'` guard
 * resolve instead of hanging the job on an unknown.
 */
const PR_GITHUB_CONTEXT: Record<string, string> = { event_name: "pull_request" };

/**
 * A scope with the fixed pull-request facts filled in.
 *
 * Every `${{ }}` this module evaluates — a job `if:`, a matrix axis — is
 * evaluated for the same event, so they all get the same `github.*`. Anything
 * the caller states wins; there is nothing here worth overriding, but a scope
 * that silently ignored what it was handed would be the wrong shape.
 */
export const prScope = (scope: Scope): Scope => ({
  ...scope,
  github: { ...PR_GITHUB_CONTEXT, ...scope.github },
});
