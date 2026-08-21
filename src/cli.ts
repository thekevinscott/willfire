#!/usr/bin/env node
// Usage: pnpm predict --repo owner/name --pr N [--json]
//
// Auth: GH_TOKEN or GITHUB_TOKEN env var (any token with
// contents/actions/pull-requests read). Inside an action, pass the workflow's
// GITHUB_TOKEN.

import { parseArgs } from "./cli/parseArgs.js";
import { isWorkflowEntry } from "./entries/isWorkflowEntry.js";
import { makeOctokit } from "./predict/makeOctokit.js";
import { predict } from "./predict/predict.js";

const isMain = /cli\.(ts|js)$|\/willfire$/.test(process.argv[1] ?? "");
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const prediction = await predict(makeOctokit(), args.repo, args.pr, {
    action: args.action,
    execute: args.execute,
  });
  const { entries, skip, sources } = prediction;
  if (args.json) {
    console.log(JSON.stringify(prediction, null, 2));
  } else {
    if (skip) {
      console.log(`# ${skip} -> nothing dispatches`);
    } else {
      for (const e of entries) {
        if (isWorkflowEntry(e)) console.log(`# ${e.workflow} :: ${e.status} (${e.reason})`);
        else {
          const name = e.checkName ?? `${e.job} (name unresolved)`;
          console.log(`${e.workflow} :: ${name} :: ${e.status}`);
        }
      }
    }
    // Last, and on the skip path too, so a red gate's first question — which
    // commits was this read from? — is answered wherever the reader lands.
    for (const s of sources) console.log(`# read ${s.owner}/${s.repo}@${s.ref} -> ${s.sha}`);
  }
}
