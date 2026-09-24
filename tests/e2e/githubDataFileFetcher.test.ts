import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "../../src/index.js";
import { dispatchedNames } from "./dispatchedNames.js";

interface Expected {
  repo: string;
  pr: number;
  headSha: string;
  checkNames: string[];
}

const expected = JSON.parse(
  readFileSync(new URL("./fixtures/github-data-file-fetcher-3.json", import.meta.url), "utf8"),
) as Expected;

test("github-data-file-fetcher#3 still predicts and still dispatches the committed list", async () => {
  const github = makeGithubClient();
  const [owner, name] = expected.repo.split("/");

  const pull = await github.getPull({ owner, repo: name, pull_number: expected.pr });
  expect(pull.head.sha).toBe(expected.headSha);

  const { checkNames } = await predict(github, expected.repo, expected.pr);
  expect(checkNames).toEqual(expected.checkNames);

  const dispatched = await dispatchedNames(github, owner, name, expected.headSha);
  expect(dispatched).toEqual(expected.checkNames);
});
