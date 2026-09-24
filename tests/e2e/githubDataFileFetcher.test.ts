import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "../../src/index.js";

interface Expected {
  repo: string;
  pr: number;
  headSha: string;
  checkNames: string[];
}

const github = makeGithubClient();

const CASES = ["github-data-file-fetcher/3"];

test.each(CASES)("%s still predicts the committed list", async (name) => {
  const expected = JSON.parse(
    readFileSync(new URL(`./fixtures/${name}/fixture.json`, import.meta.url), "utf8"),
  ) as Expected;
  const [owner, repoName] = expected.repo.split("/");

  const pull = await github.getPull({ owner, repo: repoName, pull_number: expected.pr });
  expect(pull.head.sha).toBe(expected.headSha);

  const { checkNames } = await predict(github, expected.repo, expected.pr);
  expect(checkNames).toEqual(expected.checkNames);
});
