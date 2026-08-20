# willfire

Predicts the set of CI check entries GitHub Actions will create for a pull
request — before (or without) the runs happening.

GitHub's dispatch decision is server-side and unpublished: no API tells you
which workflows will fire for a PR after branch/path/type filters, or which
job entries they expand into. willfire evaluates the workflow files statically
against the PR's base branch, changed files, and head commit message.

## Install

```sh
pnpm add willfire
```

## Library

```ts
import { predict } from "willfire";
import { getOctokit } from "@actions/github"; // or new Octokit({ auth: token })

const { entries, checkNames, skip } = await predict(getOctokit(token), "owner/repo", 123);
// checkNames: sorted, deduped checkName of every entry with status "run"
```

`entries` is a union of two variants, both carrying `workflow` and `reason`:

| variant | `job` | `checkName` | `status` |
| --- | --- | --- | --- |
| `WorkflowEntry` | `"*"` | always `null` | `"run" \| "skipped" \| "no-dispatch"` |
| `JobEntry` | the job id | the check name, or `null` | `"run" \| "skipped" \| "unknown" \| "no-dispatch"` |

`"unknown"` is job-level only: every workflow-level verdict is decidable, so a
`WorkflowEntry` cannot express one. Narrow with the exported `isWorkflowEntry`
and `isJobEntry` guards rather than testing the `"*"` sentinel yourself.

`checkName` is the name GitHub actually puts on the check — `name:` override,
matrix parenthetical, and `<caller> / <callee>` prefixing for reusable
workflows all applied. That is the unit required status checks key on, so it
is the one worth comparing against. On a `JobEntry` it is `null` only where no
single name is knowable ahead of the run:

- a matrix computed at runtime (`fromJSON` of another job's output), reported
  as one `unknown` entry for that job and nothing else;
- a reusable workflow we cannot read — private, deleted, a ref that does not
  exist, a `uses:` built from an expression, or one nested past GitHub's
  four-level limit;
- a `name:` interpolating something we cannot evaluate statically.

Duplicate names in `checkNames` are not possible (it is a set), but duplicate
check names *are* — GitHub happily creates two identically named checks when a
matrix job's `name:` does not vary per combination. `entries` shows them.

Auth is any token with `contents: read`, `actions: read`, and
`pull-requests: read` — inside an action, the workflow's `GITHUB_TOKEN`.

## CLI

```sh
GH_TOKEN=... willfire --repo owner/repo --pr 123 [--json]
```

## What it handles

Path filters (`paths`, `paths-ignore`, order-sensitive `!` negation), branch
filters, event `types`, combined filters, `[skip ci]` and friends, disabled
workflows, multi-job workflows, static matrix expansion (including
`exclude`/`include`), `needs` skip-propagation, job-level `if`, and reusable
workflows — both the local `./.github/workflows/x.yml` form and the cross-repo
`owner/repo/.github/workflows/x.yml@ref` form, whose callee is fetched from its
own repo at the pinned tag, branch, or SHA. Jobs whose `if` is false are
predicted as `skipped` entries, matching how they appear in the checks UI.

Things that cannot be known statically — e.g. a matrix computed at runtime
from another job's output — are reported as `unknown` rather than guessed.

## Development

```sh
pnpm install
pnpm typecheck        # tsc over src/, tests included
pnpm test             # vitest, once
pnpm test:coverage    # the 100% floor CI enforces
```

Unit tests are colocated with their source (`foo.ts` ↔ `foo.test.ts`) at 100%
coverage, per the
[testing-conventions](https://github.com/thekevinscott/testing-conventions)
standard. `.github/workflows/conventions.yml` enforces that in CI;
`testing-conventions.toml` holds the thresholds.

## Verification

The unit suite fixes the behavior. What fixes the *expectations* is the probe:
predictions are verified against real GitHub behavior, not just the docs.
[willrun-probe](https://github.com/thekevinbot/willrun-probe) holds one
workflow per dispatch rule, and probe PRs exercise each complication
(docs-only diffs, negation edges, `[skip ci]`, a 301-file diff, PRs into
non-default branches). The `verify` script diffs predictions against the
check entries GitHub actually created. All probe PRs currently pass exactly.

Check-name resolution is verified the same way, on probe PRs #8 and #9.
`pnpm test` replays those probe workflows through the resolver and asserts the
exact job names the live run produced. Several of the rules it pins are ones
the docs do not state:

- a `name:` containing *any* `${{ }}` expression suppresses the matrix
  parenthetical, even an expression that never reads the matrix — a literal
  `name:` still gets one, so `name: Static Label` over `a: [x, y]` yields
  `Static Label (x)` and `Static Label (y)`;
- keys an `include` entry merges into an existing combination do not appear in
  the name, but keys of a combination the `include` created from scratch do;
- object matrix values flatten to their own values, so `{os: linux, arch: x64}`
  renders as `(linux, x64)`;
- a skipped job is never set up, so its matrix does not expand and its `name:`
  is not interpolated: one check, expression text and all;
- a cross-repo `uses:` names the same `<caller> / <callee>` checks a local one
  does, at whichever tag, branch, or SHA the `@ref` pinned — and a relative
  `uses: ./...` *inside* that callee resolves against the callee's repo and
  ref, not the caller's. Probe PR #9 settles the second one: the caller's copy
  of the callee's file was present at head, under a different job name, and
  GitHub did not use it.

Scope notes: validated on `opened` pull_request events; `synchronize`/`labeled`
live events, `branches-ignore`, and diffs far beyond 301 files are not yet
probe-verified. Reusable-workflow name prefixing is probe-verified to three
levels; deeper nesting is inferred. The cross-repo probe calls back into the
probe repo itself by full `owner/repo@ref` reference, so it pins ref
resolution but not the owner/repo half of the address.
