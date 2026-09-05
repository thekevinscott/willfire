// Compare predict.ts output against what GitHub Actions actually dispatched.
//
// Usage: pnpm verify --repo owner/name --pr N
//
// Ground truth: workflow runs for the PR head SHA with a pull_request event,
// and the job entries inside each run (skipped jobs included).

import { isJobEntry, makeGithubClient, predict } from "willfire";
import type { GithubClient } from "willfire";
import { get } from "./get.js";

async function actualEntries(github: GithubClient, repo: string, prNumber: number) {
  const [owner, name] = repo.split("/");
  const base = { owner, repo: name };
  const pr = await github.getPull({ ...base, pull_number: prNumber });
  const runs = await github.listWorkflowRuns({
    ...base,
    head_sha: pr.head.sha,
    event: "pull_request",
  });
  const entries = new Map<string, "run" | "skipped">();
  const incomplete: string[] = [];
  for (const run of runs) {
    if (run.status !== "completed") {
      incomplete.push(run.path);
    }
    const jobs = await github.listRunJobs({ ...base, run_id: run.id });
    for (const j of jobs) {
      entries.set(
        `${run.path} :: ${j.name}`,
        j.conclusion === "skipped" ? "skipped" : "run",
      );
    }
  }
  return { entries, incomplete };
}

const repo = get("--repo");
const prArg = get("--pr");
if (!repo || !prArg) {
  console.error("usage: verify --repo owner/name --pr N");
  process.exit(2);
}
const pr = Number(prArg);

const github = makeGithubClient();
const { entries: predictedRaw } = await predict(github, repo, pr);
// Compare on the resolved check name — that is the string GitHub actually
// puts on the job. Entries whose name could not be resolved statically have
// no key to compare and are reported separately below.
const predicted = new Map(
  predictedRaw
    .filter((r) => isJobEntry(r) && r.checkName !== null)
    .map((r) => [`${r.workflow} :: ${r.checkName}`, r.status]),
);
const unresolved = predictedRaw.filter(isJobEntry).filter((r) => r.checkName === null);
const unknownWfs = new Set(
  predictedRaw
    .filter((r) => r.status === "unknown")
    .map((r) => r.workflow)
    .concat(unresolved.map((r) => r.workflow)),
);
const { entries: actual, incomplete } = await actualEntries(github, repo, pr);

if (incomplete.length > 0) {
  console.log(`WARNING: runs still in progress: ${incomplete}`);
}

let ok = true;
const keys = [...new Set([...predicted.keys(), ...actual.keys()])].sort();
for (const key of keys) {
  const p = predicted.get(key);
  const a = actual.get(key);
  const wf = key.split(" :: ")[0];
  if (p === a) {
    console.log(`  OK  ${key} :: ${a}`);
  } else if (p === "unknown") {
    console.log(`  ?   ${key} :: predicted unknown, actual ${a}`);
  } else if (p === undefined) {
    // An undecided entry elsewhere in the workflow annotates the miss, it never
    // excuses it: willfire's contract is the exact set, so a check it did not
    // name is a check it got wrong.
    ok = false;
    const note = unknownWfs.has(wf) ? ", workflow had an undecided entry" : "";
    console.log(`MISS  ${key} :: ran (${a}) but was not predicted${note}`);
  } else if (a === undefined) {
    ok = false;
    console.log(`OVER  ${key} :: predicted ${p} but never appeared`);
  } else {
    ok = false;
    console.log(`DIFF  ${key} :: predicted ${p}, actual ${a}`);
  }
}

for (const r of unresolved) {
  console.log(`  ?   ${r.workflow} :: ${r.job} :: name unresolved: ${r.reason}`);
}


console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
