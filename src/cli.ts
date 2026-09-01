#!/usr/bin/env node
// Usage: pnpm predict --repo owner/name --pr N [--json] [--no-execute]
// Auth: GH_TOKEN or GITHUB_TOKEN, needing contents/actions/pull-requests read.

import { parseArgs } from "./cli/parseArgs.js";
import { isWorkflowEntry } from "./entries/isWorkflowEntry.js";
import { makeGithubClient } from "./predict/makeGithubClient.js";
import { predict } from "./predict/predict.js";

const isMain = /cli\.(ts|js)$|\/willfire$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const prediction = await predict(makeGithubClient(), args.repo, args.pr, {
    action: args.action,
    // `undefined` is predict's "build the live executor"; only `null` is off.
    executor: args.execute ? undefined : null,
  });
  const { entries, skip, sources } = prediction;
  if (args.json) {
    console.log(JSON.stringify(prediction, null, 2));
  } else {
    if (skip) {
      console.log(`# ${skip} -> nothing dispatches`);
    } else {
      for (const e of entries) {
        if (isWorkflowEntry(e)) {
          console.log(`# ${e.workflow} :: ${e.status} (${e.reason})`);
        } else {
          const name = e.checkName ?? `${e.job} (name unresolved)`;
          console.log(`${e.workflow} :: ${name} :: ${e.status}`);
        }
      }
    }
    // Last, and on the skip path too, so a red gate's reader always sees which
    // commits this was read from.
    for (const s of sources) {
      console.log(`# read ${s.owner}/${s.repo}@${s.ref} -> ${s.sha}`);
    }
  }
}
