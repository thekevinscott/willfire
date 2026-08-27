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
import { makeGithubClient, predict } from "willfire";

// makeGithubClient reads GH_TOKEN or GITHUB_TOKEN from the environment; any
// object satisfying the exported GithubClient interface works in its place.
const { entries, checkNames, skip, sources } = await predict(
  makeGithubClient(),
  "owner/repo",
  123,
  { action: context.payload.action }, // "opened" | "synchronize" | "reopened"
);
// checkNames: sorted, deduped checkName of every entry with status "run"
// sources: every repo read, and the commit each ref resolved to
```

`action` is optional but worth passing. Omitted, the event action is inferred
from the PR's commit count, which is wrong in both directions — a PR opened
from a branch with several commits looks like `synchronize`, a force-push down
to one commit looks like `opened` — and can never produce `reopened`. That only
matters to a workflow narrowing `types:`, where it decides whether the workflow
dispatches at all.

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

- a matrix computed at runtime (`fromJSON` of another job's output) that
  execution could not resolve, reported as one `unknown` entry for that job
  and nothing else — see "Executing needed jobs" below;
- a reusable workflow we cannot read — private, deleted, a ref that does not
  exist, a `uses:` built from an expression, or one nested past GitHub's
  four-level limit;
- a `name:` interpolating something we cannot evaluate statically.

`sources` is the provenance of the answer: the PR's own repo at the head
commit, then one entry per cross-repo `uses:` that was read, each carrying both
the `ref` the workflow wrote and the `sha` it resolved to. A ref is resolved
before the file behind it is read, so the commit named is the commit used. `v0`
is a tag someone moves; without the sha, "willfire predicted these checks" is
not a claim that can be checked against the run afterwards.

A ref that will not resolve is not a source. Its callee is never read, the jobs
behind it come back `unknown`, and nothing falls back to reading the mutable
ref.

Duplicate names in `checkNames` are not possible (it is a set), but duplicate
check names *are* — GitHub happily creates two identically named checks when a
matrix job's `name:` does not vary per combination. `entries` shows them.

Auth is any token with `contents: read`, `actions: read`, and
`pull-requests: read` — inside an action, the workflow's `GITHUB_TOKEN`.

## CLI

```sh
GH_TOKEN=... willfire --repo owner/repo --pr 123 \
  [--action opened|synchronize|reopened] [--json]
```

Plain-text output is one line per entry, then a `# read owner/repo@ref -> sha`
line per source. `--json` prints the whole `Prediction`, `sources` included.

## What it handles

Path filters (`paths`, `paths-ignore`, order-sensitive `!` negation), branch
filters, event `types`, combined filters, `[skip ci]` and friends, disabled
workflows, multi-job workflows, static matrix expansion (including
`exclude`/`include`), `needs` skip-propagation, job-level `if`, and reusable
workflows — both the local `./.github/workflows/x.yml` form and the cross-repo
`owner/repo/.github/workflows/x.yml@ref` form, whose ref is resolved to a
commit and the callee then read at that commit. Jobs whose `if` is false are
predicted as `skipped` entries, matching how they appear in the checks UI.

A matrix computed by another job's outputs is not static; willfire resolves it
by running that job in a sandbox — see "Executing needed jobs". Everything
else that cannot be known is reported as `unknown` rather than guessed.

## Supplying job outputs

A matrix built from another job's output is the common way a workflow decides
its own check names:

```yaml
strategy:
  matrix:
    language: ${{ fromJSON(needs.detect.outputs.coverage_languages) }}
```

Given those outputs, willfire expands it. `expandWorkflowJobs` takes a `scope`
whose `needs` maps a job id to its outputs:

```ts
await expandWorkflowJobs(wf, ctx, fetchWorkflow, source, {
  needs: { detect: { outputs: { coverage_languages: '["typescript"]' } } },
});
```

Values are raw strings — what a step wrote to `$GITHUB_OUTPUT`, and what the
runner substitutes. Parsing them here would break the guards written against
them: `!= '[]'` compares a string to a string, and an array on the left makes
it unknown. `fromJSON` is the only thing that turns one into a structure.

`outputs` must be the job's *complete* output set, because a key absent from it
reads as the empty string — the same answer the runner gives for an output no
step wrote. A job you know nothing about belongs left out entirely; every
lookup against it then stays unknown.

`needs` is workflow-scoped and is not inherited across a reusable-workflow
call: a callee's `needs.detect` is the callee's own job.

Nothing here guesses what those outputs are. By default `predict` computes
them, by executing the jobs that produce them — the section below. With
execution turned off (`executor: null` in `PredictOptions`) a dynamic matrix
stays `unknown`.

## Executing needed jobs

The job those outputs come from is usually a few shell steps over the checked
out tree — cheap to run for real. `predict` does that, and works out for
itself which jobs are worth it: a job is executed exactly when some sibling
job reads its `needs.<id>.outputs`. That fact is written in the workflow being
predicted, so there is nothing to configure and no repo knowledge in willfire.

Each selected job that is predicted to run is executed before expansion reads
`needs`: the PR's head tree is materialized from a tarball, the job's steps
run in order under their declared shell and env, step-level `if:` guards are
evaluated, composite actions are fetched at their pinned commit and recursed
into, and a bare `actions/checkout` is satisfied by the tree already present.
A checkout asking for history (`fetch-depth: 0`) switches the workspace to a
real clone at the same commit. What the steps write to `$GITHUB_OUTPUT`
becomes the job's outputs, exactly as if they had been supplied by hand.

The steps execute for real — nothing interprets or approximates shell — and
the code that runs is the PR's own version of itself. What makes that safe to
do by default is the sandbox: steps run in a docker container with no network,
none of the host's environment, no credentials, an unprivileged user, and a
read-only image (`node:24-slim` plus git and python3), with only the workspace tree
writable. Docker is the one runtime requirement; where it is missing,
execution fails and the entries that needed it stay `unknown` with the reason
attached.

Node actions (`runs.using: node24`) run under the sandbox's node with their
`inputs:` bound as `INPUT_*` variables; `actions/setup-node` is satisfied as a
no-op when it asks for exactly the node the sandbox has. Anything execution
cannot do faithfully fails rather than guessing: a Docker action, a node
action wanting another major, a checkout with inputs beyond `fetch-depth`, a
matrix'd or containerized job, an undecidable step `if:`, a non-zero exit,
output willfire cannot parse. The failure does not change any verdict —
entries that needed the outputs stay `unknown`, with the reason threaded
through:

```
dynamic matrix; executing 'detect' failed: step 'scan': exited 1 (...)
```

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
probe-verified — passing `action` explicitly is what makes probing the other
two possible. `action` accepts the three default `types:` only; `pull_request`
fires on around twenty actions, and a workflow narrowing to `ready_for_review`
or `edited` is out of scope either way. Reusable-workflow name prefixing is probe-verified to three
levels; deeper nesting is inferred. The cross-repo probe calls back into the
probe repo itself by full `owner/repo@ref` reference, so it pins ref
resolution but not the owner/repo half of the address.
