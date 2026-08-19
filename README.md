# willrun

Predicts the set of CI check entries GitHub Actions will create for a pull
request — before (or without) the runs happening.

GitHub's dispatch decision is server-side and unpublished: no API tells you
which workflows will fire for a PR after branch/path/type filters, or which
job entries they expand into. willrun evaluates the workflow files statically
against the PR's base branch, changed files, and head commit message.

## Install

```sh
pnpm add willrun
```

## Library

```ts
import { predict } from "willrun";
import { getOctokit } from "@actions/github"; // or new Octokit({ auth: token })

const { entries, skip } = await predict(getOctokit(token), "owner/repo", 123);
// entries: [{ workflow, job, status: "run" | "skipped" | "unknown" | "no-dispatch", reason }]
```

Auth is any token with `contents: read`, `actions: read`, and
`pull-requests: read` — inside an action, the workflow's `GITHUB_TOKEN`.

## CLI

```sh
GH_TOKEN=... willrun --repo owner/repo --pr 123 [--json]
```

## What it handles

Path filters (`paths`, `paths-ignore`, order-sensitive `!` negation), branch
filters, event `types`, combined filters, `[skip ci]` and friends, disabled
workflows, multi-job workflows, static matrix expansion (including
`exclude`/`include`), `needs` skip-propagation, job-level `if`, and local
reusable workflows. Jobs whose `if` is false are predicted as `skipped`
entries, matching how they appear in the checks UI.

Things that cannot be known statically — e.g. a matrix computed at runtime
from another job's output — are reported as `unknown` rather than guessed.

## Verification

Predictions are verified against real GitHub behavior, not just the docs:
[willrun-probe](https://github.com/thekevinbot/willrun-probe) holds one
workflow per dispatch rule, and probe PRs exercise each complication
(docs-only diffs, negation edges, `[skip ci]`, a 301-file diff, PRs into
non-default branches). The `verify` script diffs predictions against the
check entries GitHub actually created. All probe PRs currently pass exactly.

Scope notes: validated on `opened` pull_request events; `synchronize`/`labeled`
live events, cross-repo reusable workflows, `branches-ignore`, and diffs far
beyond 301 files are not yet probe-verified.
