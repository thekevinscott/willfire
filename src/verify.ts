import { Octokit } from "@octokit/rest";
import { isJobEntry, makeOctokit, predict } from "./index.js";

async function actualEntries(octokit: Octokit, repo: string, prNumber: number) {
  const [owner, name] = repo.split("/");
  const base = { owner, repo: name };
  const { data: pr } = await octokit.rest.pulls.get({ ...base, pull_number: prNumber });
  const runs = await octokit.paginate(octokit.rest.actions.listWorkflowRunsForRepo, {
    ...base,
    head_sha: pr.head.sha,
    event: "pull_request",
    per_page: 100,
  });
  const entries = new Map<string, "run" | "skipped">();
  const incomplete: string[] = [];
  for (const run of runs) {
    if (run.status !== "completed") {
      incomplete.push(run.path);
    }
    const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
      ...base,
      run_id: run.id,
      per_page: 100,
    });
    for (const j of jobs) {
      entries.set(
        `${run.path} :: ${j.name}`,
        j.conclusion === "skipped" ? "skipped" : "run",
      );
    }
  }
  return { entries, incomplete };
}

const get = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const repo = get("--repo");
const prArg = get("--pr");
if (!repo || !prArg) {
  console.error("usage: verify --repo owner/name --pr N");
  process.exit(2);
}
const pr = Number(prArg);

const octokit = makeOctokit();
const { entries: predictedRaw } = await predict(octokit, repo, pr);
const predicted = new Map(
  predictedRaw
    .filter(isJobEntry)
    .filter((r) => r.checkName != null)
    .map((r) => [`${r.workflow} :: ${r.checkName}`, r.status]),
);
const unresolved = predictedRaw.filter(isJobEntry).filter((r) => r.checkName == null);
const unknownWfs = new Set(
  predictedRaw
    .filter((r) => r.status === "unknown")
    .map((r) => r.workflow)
    .concat(unresolved.map((r) => r.workflow)),
);
const { entries: actual, incomplete } = await actualEntries(octokit, repo, pr);

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
    if (unknownWfs.has(wf)) {
      console.log(`  ?   ${key} :: actual ${a}, workflow had unknown prediction`);
    } else {
      ok = false;
      console.log(`MISS  ${key} :: ran (${a}) but was not predicted`);
    }
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
