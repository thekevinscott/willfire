# Pinned dispatches

One JSON cassette per pinned pull request. Each is a record of a dispatch that
happened: the checks GitHub created, the commits it created them from, the
workflow files as they read at those commits, and what running the jobs that
decide a runtime matrix yielded. `../../integration/pinned-dispatches.test.ts`
replays one and asserts the prediction matches, with no network, no token and
no docker.

These are records in the same sense `../willrun-probe/` is. Nothing here is
inferred and nothing is hand-written, so **editing a cassette is a claim that
GitHub's behaviour changed** — re-record it against a live dispatch instead.

## What a cassette holds

| field | what it is |
|---|---|
| `shape` | which workflow shape this pin exists to hold |
| `commits` | the PR's head and merge commit — prediction reads at the merge commit and falls back to head, so both are pinned |
| `dispatched` | every check the run created, skipped ones included: the ground truth |
| `predicted.checkNames` | the check list the prediction produced, one string per check, matrix combinations included |
| `predicted.entries` | every entry's verdict, `unknown` included, so an entry that stops being decided fails the test instead of passing quietly |
| `predicted.sources` | every repo the prediction read and the commit each ref resolved to |
| `recording.api` | every GitHub read the prediction made, narrowed to the fields willfire looks at |
| `recording.exec` | what running a job whose output another job reads yielded |

`reason` rides along only on undecided entries. A decided entry's reason is
prose a refactor rewords; an undecided one's reason is the evidence that it is
undecided for the modelled cause and not because the recorder's docker or
network was broken.

## Regenerating one

```
pnpm exec tsx tests/fixtures/pinned/record.ts \
  --repo owner/name --pr N --shape "what this pin holds"
```

Needs `GH_TOKEN` (or `GITHUB_TOKEN`) and a working docker — job execution is
captured by running the jobs the way `predict` runs them. The recorder refuses
to write when any run for the head commit is still in flight, and when the
prediction disagrees with the dispatch, so no cassette can encode an answer
that was already wrong when it was captured.

## What cannot be re-recorded

A cassette can only be captured while the repo state that produced the dispatch
is still current. dirsql's `release-ci.yml` computes its release matrix from a
`plan` job that reads versions off the repo, so re-predicting a PR whose
dispatch predates a release yields versions that dispatch never saw, and the
recorder refuses it. Only the newest dirsql PR at capture time could be
recorded for that shape. That is an argument for a dedicated test repo whose
state does not move, not for relaxing the guard.
