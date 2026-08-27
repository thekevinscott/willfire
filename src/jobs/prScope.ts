import type { Scope } from "../expr/val.js";

const PR_GITHUB_CONTEXT: Record<string, string> = { event_name: "pull_request" };

export const prScope = (scope: Scope): Scope => ({
  ...scope,
  github: { ...PR_GITHUB_CONTEXT, ...scope.github },
});
