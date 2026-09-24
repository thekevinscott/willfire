import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "willfire";
import { discoverCases } from "../cases.js";

const github = makeGithubClient();

const CASES = discoverCases(new URL("./responses/", import.meta.url));

const getResponse = (dir: string): string[] =>
  JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as string[];

test.each(CASES)(
  "$owner/$repo#$pr still predicts the committed list",
  async ({ owner, repo, pr, dir }) => {
    const expected = getResponse(dir);

    const { checkNames } = await predict(github, `${owner}/${repo}`, pr);

    expect(checkNames).toEqual(expected);
  },
);
