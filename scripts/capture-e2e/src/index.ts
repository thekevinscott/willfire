// Regenerates one pinned capture from a live dispatch. Needs GH_TOKEN (or
// GITHUB_TOKEN) and a working docker: job execution is captured by running the
// jobs the way `predict` runs them, not by describing what they would do.
//
// Usage: pnpm capture-e2e --repo owner/name --pr N --shape "what this pin holds"

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeGithubClient, predict } from "willfire";
import { makeLiveExecutor } from "willfire/internal";
import { predictedEntries, reconcile } from "../../../tests/fixtures/pinned/capture.js";
import { buildCapture } from "./buildCapture.js";
import { dispatchedChecks } from "./dispatchedChecks.js";
import { makeRecordingClient } from "./makeRecordingClient.js";
import { makeRecordingExecutor } from "./makeRecordingExecutor.js";
import { makeResolveRef } from "./makeResolveRef.js";
import { parseArgs } from "./parseArgs.js";

const { repo, pr: prNumber, shape } = parseArgs(process.argv.slice(2));
const [owner, name] = repo.split("/");

const { client, api } = makeRecordingClient(makeGithubClient());
const { data: pr } = await client.rest.pulls.get({
  owner,
  repo: name,
  pull_number: prNumber,
});

// Mirrors the workspace `predict` builds — the test merge commit, falling back
// to head when the PR has none; the guard after the prediction catches the day
// that stops being true.
const mergeSha = pr.merge_commit_sha;
const readSha = mergeSha === null ? pr.head.sha : mergeSha;
const workspace = { owner, repo: name, ref: readSha, sha: readSha };
const { executor, exec } = makeRecordingExecutor(
  makeLiveExecutor(client, workspace, makeResolveRef(client)),
);

const prediction = await predict(client, repo, prNumber, { executor });

const workspaceSource = prediction.sources.find(
  (s) => s.owner === owner && s.repo === name && s.sha === workspace.sha,
);
if (workspaceSource === undefined) {
  console.error(
    `predict no longer reads ${repo} at ${workspace.sha}; update the workspace in capture-e2e`,
  );
  process.exit(1);
}

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

// A capture that disagrees with its own dispatch would pin a wrong answer as
// the expected one, so the recorder refuses to write it.
const entries = predictedEntries(prediction.entries);
const disagreements = reconcile(dispatched, entries);
if (disagreements.length > 0) {
  console.error(`prediction disagrees with the dispatch; refusing to record ${repo}#${prNumber}:`);
  for (const line of disagreements) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

const capture = buildCapture({
  repo,
  pr: prNumber,
  shape,
  commits: { head: pr.head.sha, merge: pr.merge_commit_sha },
  dispatched,
  predicted: {
    checkNames: prediction.checkNames,
    entries,
    sources: prediction.sources,
    skip: prediction.skip,
  },
  recording: { api: [...api.values()], exec: [...exec.values()] },
});

const out = fileURLToPath(
  new URL(`../../../tests/fixtures/pinned/${name}-${prNumber}.json`, import.meta.url),
);
await writeFile(out, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`wrote ${out}: ${dispatched.length} dispatched, ${api.size} reads, ${exec.size} runs`);
