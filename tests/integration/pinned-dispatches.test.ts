/**
 * Six pinned PRs, replayed against the dispatch each one actually produced.
 *
 * Every expectation here was read off a live dispatch on a fleet repo and
 * captured whole by `scripts/record-cassette/`: the checks GitHub
 * created, the commits it created them from, the workflow files as they read at
 * those commits, and what running the jobs that decide a runtime matrix
 * yielded. Nothing is inferred and nothing is hand-written, so a diff to a
 * cassette is a claim that GitHub's behaviour changed — the same standard
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
  type Cassette,
} from "../fixtures/pinned/cassette.js";

/**
 * One per shape the probe repo does not exercise, two PRs each: dirsql for
 * filters at fleet scale and a runtime-computed release matrix, putitoutthere
 * for a reusable-workflow fan-out that is honestly undecidable, pr-monitor for
 * the testing-conventions dispatch every fleet repo gates on.
 */
const CASSETTES = [
  "dirsql-1010.json",
  "dirsql-1014.json",
  "putitoutthere-647.json",
  "putitoutthere-649.json",
  "pr-monitor-24.json",
  "pr-monitor-26.json",
];

const load = (file: string): Cassette =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/pinned/${file}`, import.meta.url)), "utf8"),
  ) as Cassette;

for (const file of CASSETTES) {
  const cassette = load(file);
  test(`${cassette.repo}#${cassette.pr}: ${cassette.shape}`, async () => {
    const { client, misses: reads } = replayClient(cassette);
    const { executor, misses: runs } = replayExecutor(cassette);
    const prediction = await predict(client, cassette.repo, cassette.pr, { executor });

    // A gap in the recording would otherwise surface as an entry quietly
    // degrading to `unknown`, since that is what `predict` does with a read it
    // cannot make. Checked first so an incomplete cassette says so.
    expect({ reads, runs }).toEqual({ reads: [], runs: [] });

    // The check list, exactly: one string per check, matrix combinations
    // included. This is the answer consumers gate on.
    expect(prediction.checkNames).toEqual(cassette.predicted.checkNames);

    // Every entry's verdict, `unknown` included, so an entry that stops being
    // decided fails here instead of passing as "no disagreement".
    expect(predictedEntries(prediction.entries)).toEqual(cassette.predicted.entries);
    expect(prediction.skip).toBe(cassette.predicted.skip);
    expect(prediction.sources).toEqual(cassette.predicted.sources);

    // Prediction read the PR's own repo at a commit the cassette pins. Both
    // are pinned because prediction reads at the merge commit and falls back
    // to head, and a fixture that named neither could not be checked by hand.
    const [owner, name] = cassette.repo.split("/");
    const own = prediction.sources.filter((s) => s.owner === owner && s.repo === name);
    expect(own.map((s) => s.sha)).toContain(cassette.commits.head);
    expect([cassette.commits.head, cassette.commits.merge]).toContain(own[0].sha);

    // What makes `dispatched` load-bearing rather than decoration: the
    // prediction has to agree with the run GitHub actually produced.
    expect(reconcile(cassette.dispatched, cassette.predicted.entries)).toEqual([]);
  });
}
