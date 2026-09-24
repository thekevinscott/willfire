import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { makeGithubClient, predict } from "../../src/index.js";
import { dispatchedNames } from "./dispatchedNames.js";

const REPO = "thekevinscott/github-data-file-fetcher";
const PR = 3;

// Both sides are read live, so this can never go red for the reason a frozen
// expectation goes red. A failure here means GitHub moved.
test("github-data-file-fetcher#3 still predicts what GitHub still dispatches", async () => {
  const github = makeGithubClient();
  const [owner, name] = REPO.split("/");

  const { entries, checkNames } = await predict(github, REPO, PR);
  const pull = await github.getPull({ owner, repo: name, pull_number: PR });
  const dispatched = await dispatchedNames(github, owner, name, pull.head.sha);

  writeFileSync(
    new URL("./fixtures/github-data-file-fetcher-3.json", import.meta.url),
    `${JSON.stringify(
      { repo: REPO, pr: PR, headSha: pull.head.sha, predicted: checkNames, dispatched, entries },
      null,
      2,
    )}\n`,
  );

  expect(checkNames).toEqual(dispatched);
});
