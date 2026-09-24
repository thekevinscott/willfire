import { expect, test } from "vitest";
import { makeGithubClient, predict } from "willfire";
import { discoverCases } from "../cases.js";
import { getResponse } from "./getResponse.js";

const github = makeGithubClient();

const CASES = discoverCases(new URL("./responses/", import.meta.url));

test.each(CASES)(
  "$owner/$repo#$pr still predicts the committed list",
  async ({ owner, repo, pr, dir }) => {
    const expected = getResponse(dir);

    const { checkNames } = await predict(github, `${owner}/${repo}`, pr);

    expect(checkNames).toEqual(expected);
  },
);
