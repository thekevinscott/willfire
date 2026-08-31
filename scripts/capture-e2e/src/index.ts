// Records one pinned dispatch from a live PR. Needs GH_TOKEN (or GITHUB_TOKEN).
// It reads what GitHub dispatched and nothing else: the prediction to compare
// it against is produced live by tests/e2e/pinned-prs.test.ts.
//
// Usage: pnpm capture-e2e --repo owner/name --pr N

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeGithubClient } from "willfire";
import { buildCapture } from "./buildCapture.js";
import { dispatchedChecks } from "./dispatchedChecks.js";
import { parseArgs } from "./parseArgs.js";

const { repo, pr: prNumber } = parseArgs(process.argv.slice(2));
const [owner, name] = repo.split("/");

const client = makeGithubClient();
const { data: pr } = await client.rest.pulls.get({
  owner,
  repo: name,
  pull_number: prNumber,
});

const { checks: dispatched, incomplete } = await dispatchedChecks(
  client,
  owner,
  name,
  pr.head.sha,
);
if (incomplete.length > 0) {
  console.error(`still running: ${incomplete.join(", ")}; wait for the dispatch to settle`);
  process.exit(1);
}

const capture = buildCapture({
  repo,
  pr: prNumber,
  commits: { head: pr.head.sha, merge: pr.merge_commit_sha },
  dispatched,
});

const out = fileURLToPath(
  new URL(`../../../tests/fixtures/pinned/${name}-${prNumber}.json`, import.meta.url),
);
await writeFile(out, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`wrote ${out}: ${dispatched.length} dispatched`);
