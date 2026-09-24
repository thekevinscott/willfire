import { expect, test } from "vitest";
import { predict } from "willfire";
import { discoverCases } from "../cases.js";
import { getFixture } from "./getFixture.js";
import { replayClient } from "./replayClient.js";

const CASES = discoverCases(new URL("./fixtures/", import.meta.url));

const sortedUnique = (names: string[]): string[] => [...new Set(names)].sort();

test.each(CASES)(
  "$owner/$repo#$pr predicts the dispatched check list exactly",
  async ({ owner, repo, pr, dir }) => {
    const { calls, dispatched } = getFixture(dir);

    const { checkNames, entries } = await predict(replayClient(calls), `${owner}/${repo}`, pr);

    // `dispatched` holds every job GitHub created, whatever its conclusion,
    // while `checkNames` is only the entries willfire says will run. Splitting
    // the ground truth on `conclusion` stops a correctly predicted skip reading
    // as a missing check, and still fails a skip predicted as a run.
    const concluded = (skipped: boolean) =>
      sortedUnique(
        dispatched.filter((d) => (d.conclusion === "skipped") === skipped).map((d) => d.name),
      );

    expect(checkNames, "checks willfire predicts will run").toEqual(concluded(false));

    const predictedSkipped = sortedUnique(
      entries.flatMap((e) => (e.status === "skipped" && e.checkName !== null ? [e.checkName] : [])),
    );
    expect(predictedSkipped, "checks willfire predicts GitHub will skip").toEqual(concluded(true));
  },
);
