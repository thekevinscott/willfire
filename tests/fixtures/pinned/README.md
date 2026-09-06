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

A pin is only reproducible while the state that produced the dispatch is still
current. dirsql's `release-ci.yml` computes its release matrix in a `plan` job
that runs putitoutthere's action, and that action derives each row's version
from the **live registry** — npm, PyPI and crates.io — not from anything in the
repo (dirsql's own `package.json` says `0.0.1`). Every dirsql release therefore
invalidates every dirsql release-matrix pin at once.

Measured on 2026-09-05 (#180): npm `dirsql` went 0.4.30 → 0.4.39 in three days,
and a PyPI release landed mid-investigation, so two predictions of the same PR
thirteen minutes apart disagreed. Re-recording buys hours, and picking a
different dirsql PR buys the same hours — the drift is not a property of the PR.
So there is no dirsql PR that pins this shape, which is why none is pinned here.
Covering a runtime-computed release matrix needs a repo whose registry state
does not move; relaxing the comparison is not the answer.
