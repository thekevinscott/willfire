import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { predict } from "willfire";
import { discoverCases } from "../cases.js";
import { replayClient, type RecordedCall } from "./replayClient.js";

interface Fixture {
  dispatched: { workflow: string; name: string; conclusion: string | null }[];
  calls: RecordedCall[];
}

const CASES = discoverCases(new URL("./fixtures/", import.meta.url));

const getFixture = (dir: string): Fixture =>
  JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as Fixture;

test.each(CASES)(
  "$owner/$repo#$pr predicts the dispatched check list exactly",
  async ({ owner, repo, pr, dir }) => {
    const { calls, dispatched } = getFixture(dir);

    const { checkNames } = await predict(replayClient(calls), `${owner}/${repo}`, pr);

    expect(checkNames).toEqual([...new Set(dispatched.map((d) => d.name))].sort());
  },
);
