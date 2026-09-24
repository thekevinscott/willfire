import { expect, test } from "vitest";
import { predict } from "willfire";
import { discoverCases } from "../cases.js";
import { getFixture } from "./getFixture.js";
import { replayClient } from "./replayClient.js";

const CASES = discoverCases(new URL("./fixtures/", import.meta.url));

test.each(CASES)(
  "$owner/$repo#$pr predicts the dispatched check list exactly",
  async ({ owner, repo, pr, dir }) => {
    const { calls, dispatched } = getFixture(dir);

    const { checkNames } = await predict(replayClient(calls), `${owner}/${repo}`, pr);

    expect(checkNames).toEqual([...new Set(dispatched.map((d) => d.name))].sort());
  },
);
