import type { Prediction, PredictOptions } from "../types.js";
import type { GithubClient } from "./makeGithubClient.js";
import { willfire } from "../willfire.js";

/**
 * @deprecated Renamed to {@link willfire}. Kept until pr-monitor migrates
 * (thekevinscott/pr-monitor#97); it is the only consumer.
 */
export const predict = (
  github: GithubClient,
  repo: string,
  prNumber: number,
  opts: PredictOptions = {},
): Promise<Prediction> => willfire(github, repo, prNumber, opts);
