import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "../../src/index.js";

const github = makeGithubClient();

const CASES = [["thekevinscott/github-data-file-fetcher", 3]] as const;

test.each(CASES)("%s#%i still predicts the committed list", async (repo, pr) => {
  const url = new URL(`./responses/${repo.split("/")[1]}/${pr}/fixture.json`, import.meta.url);
  const expected = JSON.parse(readFileSync(url, "utf8")) as string[];

  const { checkNames } = await predict(github, repo, pr);

  expect(checkNames).toEqual(expected);
});
