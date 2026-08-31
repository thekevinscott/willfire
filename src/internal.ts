// Not public API. The seams the in-repo dev tools under `scripts/` need and
// `.` deliberately does not publish; `src/index.test.ts` pins that surface.
export { makeLiveExecutor } from "./predict/makeLiveExecutor.js";
export type { GithubPullSummary } from "./predict/makeGithubClient.js";
