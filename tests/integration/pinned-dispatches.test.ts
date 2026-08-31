/**
 * Six pinned PRs, replayed against the dispatch each one actually produced.
 *
 * Every expectation here was read off a live dispatch on a fleet repo and
 * captured whole by `scripts/capture-e2e/`: the checks GitHub
 * created, the commits it created them from, the workflow files as they read at
 * those commits, and what running the jobs that decide a runtime matrix
 * yielded. Nothing is inferred and nothing is hand-written, so a diff to a
 * capture is a claim that GitHub's behaviour changed — the same standard
 * `tests/fixtures/willrun-probe/` is held to.
 *
 * The pins do not drift, because none of this is read live. Replay needs no
 * network, no token and no docker, so the suite runs in the normal `pnpm test`
 * pass; `tests/e2e/pinned-prs.test.ts` is the live-network one.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { predict } from "../../src/index.js";
import {
  predictedEntries,
  reconcile,
  replayClient,
  replayExecutor,
  type E2ECapture,
} from "../fixtures/pinned/capture.js";

/**
 * One per shape the probe repo does not exercise, two PRs each: dirsql for
 * filters at fleet scale and a runtime-computed release matrix, putitoutthere
 * for a reusable-workflow fan-out that is honestly undecidable, pr-monitor for
 * the testing-conventions dispatch every fleet repo gates on.
 */
const CAPTURES = [
  "dirsql-1010.json",
  "dirsql-1014.json",
  "putitoutthere-647.json",
  "putitoutthere-649.json",
  "pr-monitor-24.json",
  "pr-monitor-26.json",
];

const load = (file: string): E2ECapture =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/pinned/${file}`, import.meta.url)), "utf8"),
  ) as E2ECapture;

for (const file of CAPTURES) {
  const capture = load(file);
  test(`${capture.repo}#${capture.pr}: ${capture.shape}`, async () => {
    const { client, misses: reads } = replayClient(capture);
    const { executor, misses: runs } = replayExecutor(capture);
    const prediction = await predict(client, capture.repo, capture.pr, { executor });

    // A gap in the recording would otherwise surface as an entry quietly
    // degrading to `unknown`, since that is what `predict` does with a read it
    // cannot make. Checked first so an incomplete capture says so.
    expect({ reads, runs }).toEqual({ reads: [], runs: [] });

    // The check list, exactly: one string per check, matrix combinations
    // included. This is the answer consumers gate on.
    expect(prediction.checkNames).toEqual(capture.predicted.checkNames);

    // Every entry's verdict, `unknown` included, so an entry that stops being
    // decided fails here instead of passing as "no disagreement".
    expect(predictedEntries(prediction.entries)).toEqual(capture.predicted.entries);
    expect(prediction.skip).toBe(capture.predicted.skip);
    expect(prediction.sources).toEqual(capture.predicted.sources);

    // Prediction read the PR's own repo at a commit the capture pins. Both
    // are pinned because prediction reads at the merge commit and falls back
    // to head, and a fixture that named neither could not be checked by hand.
    const [owner, name] = capture.repo.split("/");
    const own = prediction.sources.filter((s) => s.owner === owner && s.repo === name);
    expect(own.map((s) => s.sha)).toContain(capture.commits.head);
    expect([capture.commits.head, capture.commits.merge]).toContain(own[0].sha);

    // What makes `dispatched` load-bearing rather than decoration: the
    // prediction has to agree with the run GitHub actually produced.
    expect(reconcile(capture.dispatched, capture.predicted.entries)).toEqual([]);
  });
}
