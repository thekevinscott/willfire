# willrun-probe

Probe repo for verifying GitHub Actions dispatch prediction. Each workflow
exercises one dispatch rule; PRs are opened by a bot to test predictions
against what GitHub actually runs. See the parent project for the predictor.

Two families of workflow live here:

- **Dispatch probes** — `paths.yml`, `branches.yml`, `types.yml`, `negation.yml`
  and friends. These answer "does this workflow fire at all?"
- **Check-name probes** — `names.yml`, `names-caller.yml`, `names-mid.yml`,
  `names-reusable.yml`. These answer "what is the resolved name of each check
  it creates?" Between them they cover `name:` overrides, matrix parenthetical
  formation, `include`/`exclude`, numeric and object matrix values, skipped
  jobs, and one-, two- and three-level reusable workflow calls.
- **Cross-repo reusable probes** — `remote-caller.yml`, `remote-reusable.yml`,
  `remote-inner.yml`, `remote-bad.yml`. These answer "which repo and which ref
  does a `owner/repo/path@ref` call actually read?"
- **Step-level action probe** — `action-decline.yml`, the only workflow here
  that uses an action at all. It answers "what does GitHub run when willfire's
  executor refuses a step?" Observed on PR #15: GitHub ran `action-gen`,
  `action-use (r)` and `action-use (s)`, so the checks willfire leaves
  undecided are real ones it declined to name rather than guess.

The check-name probes are the ground truth behind willfire's
`src/names.test.ts`: every expectation in that file is a job name read back
off a live dispatch here, not a reading of the docs. When a name-resolution
rule is in question, add a job to `names.yml`, push, and read the answer out
of `actions/runs/<id>/jobs`.

## The cross-repo probe, and why it is built the way it is

`remote-caller.yml` calls back into *this* repo by its full name — a genuine
non-local reference, since GitHub treats `owner/repo/...@ref` and `./...` as
different things regardless of whether the owner and repo happen to match.

The point of the probe is that no answer is guessable, so the callee exists at
three refs that deliberately disagree:

| ref | `remote-reusable.yml` job | `remote-inner.yml` job |
| --- | --- | --- |
| tag `remote-v0`, and its SHA | `r-inner` | `deep-at-v0` |
| branch `main` (and every PR head off it) | `r-inner-at-main` | `deep-at-main` |

`remote-caller.yml` then calls the same path once per kind of ref — tag,
branch, SHA — plus a `name:`-overridden caller, a matrix caller, and a skipped
one. The job names the run creates say which ref each call read.

The deepest question it settles is what a relative `uses: ./...` *inside* a
remotely-called workflow resolves against. `remote-reusable.yml` calls
`./.github/workflows/remote-inner.yml`, and a copy of that file exists at the
caller's head too, under a different job name — so a call resolving against
the caller would have found a file and produced a plausible wrong answer
rather than failing. The observed check is
`call-remote-tag / Remote Local Call / deep-at-v0`: the callee's repo and the
callee's pinned ref win.

`remote-bad.yml` is the unresolvable case and lives in its own file because an
unresolvable `uses:` fails the whole run at startup, which would take
`remote-caller.yml`'s answers down with it. Observed: the run completes as
`failure` with **zero** jobs, so a broken cross-repo call produces no check at
all.

Both remote workflows are scoped with `paths:` to a file of their own, so they
stay out of PRs 1-8's predictions — those PRs pin rules that predate them.
