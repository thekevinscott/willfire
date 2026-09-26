import { expect, test } from "vitest";
import { predict } from "willfire";
import { discoverCases } from "../cases.js";
import { getResponse } from "../getResponse.js";
import { getCalls } from "./getCalls.js";
import { replayClient } from "./mocks/replayClient.js";

const CASES = discoverCases(new URL("./fixtures/", import.meta.url));

test.each(CASES)(
  "$owner/$repo#$pr predicts the dispatched check list exactly",
  async ({ owner, repo, pr, dir }) => {
    const { checkNames } = await predict(replayClient(getCalls(dir)), `${owner}/${repo}`, pr);

    expect(checkNames).toEqual(getResponse(dir));
  },
  // A replay with a runtime-computed matrix runs the docker sandbox, and CI
  // provisions the image inside the first such test.
  300_000,
);
