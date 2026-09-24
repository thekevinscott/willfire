# E2e tests

willfire runs live against a committed answer. Nothing is mocked.

**This suite gates nothing.** It runs on a schedule. A red means GitHub moved.

Run it with `pnpm test:e2e`. It needs `GH_TOKEN`.

## Layout

One directory per case: `responses/<repo>/<pr>/`. Its `fixture.json` is exactly
what willfire returns — the list of check names — recorded from a real
dispatch. Repo and pull request live in the path, so the file is the answer and
nothing else. Its `README.md` says why the case is here.

Tests write nothing. Updating a file is a deliberate commit acknowledging a
move.

## Why the answer is frozen and willfire is not

Comparing two live reads would miss the case this suite exists for: when GitHub
moves and willfire tracks the move, both sides change together and the test
stays green.

Reading the live dispatch back adds nothing either — these pull requests are
settled, so their runs are immutable history. Drift reaches the prediction
instead, which resolves moving tags on every run.

## Why the pull requests are fixed

Chasing the newest PR shrinks the window GitHub can move in, and makes a red
unreproducible.
