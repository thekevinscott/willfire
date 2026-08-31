# Pinned dispatches

One JSON file per pinned pull request, recording the checks GitHub actually
created for it and the commits it created them from. `tests/e2e/pinned-prs.test.ts`
predicts each PR live against `api.github.com` and asserts the predicted check
names are exactly the non-skipped names here.

These are records in the same sense `../willrun-probe/` is. Nothing here is
inferred and nothing is hand-written, so **editing a pin is a claim that
GitHub's behaviour changed** — re-record it against a live dispatch instead.

## What a pin holds

| field | what it is |
|---|---|
| `commits` | the PR's head and merge commit — prediction reads at the merge commit and falls back to head, so both are pinned |
| `dispatched` | every check the run created, skipped ones included: the ground truth |

A check GitHub concluded `skipped` was created but never ran, so the comparison
drops it. GitHub elides a long job name with a literal `...`, which collapses
several matrix combinations onto one displayed name, so the comparison is over
a set of names rather than a count.

## Regenerating one

```
pnpm capture-e2e --repo owner/name --pr N
```

Needs `GH_TOKEN` (or `GITHUB_TOKEN`). It reads only what GitHub dispatched; the
prediction to compare against is produced live by the test. The recorder refuses
to write while any run for the head commit is still in flight.

## What cannot be re-recorded

A pin is only reproducible while the repo state that produced the dispatch is
still current. dirsql's `release-ci.yml` computes its release matrix from a
`plan` job that reads versions off the repo, so re-predicting a PR whose
dispatch predates a release yields versions that dispatch never saw. That is an
argument for a dedicated test repo whose state does not move, not for relaxing
the comparison.
