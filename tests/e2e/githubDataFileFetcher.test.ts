import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "willfire";
import { discoverCases } from "../cases.js";

const github = makeGithubClient();

const CASES = discoverCases(new URL("./responses/", import.meta.url));

test.each(CASES)("$owner/$repo#$pr still predicts the committed list", async (c) => {
  const expected = JSON.parse(readFileSync(join(c.dir, "fixture.json"), "utf8")) as string[];

  const { checkNames } = await predict(github, `${c.owner}/${c.repo}`, c.pr);

  expect(checkNames).toEqual(expected);
});
