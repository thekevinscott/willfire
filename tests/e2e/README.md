# E2e tests

Both sides are live: predict against GitHub now, read what GitHub dispatched
now, compare. Nothing frozen is compared against anything current, so the drift
that turns a stale expectation red cannot reach this suite.

**This suite gates nothing.** It runs on a schedule. A red means GitHub moved,
which is the finding rather than a flake, and it must never block a merge —
that is what the integration suite is for.

Run it with `pnpm test:e2e`. It needs `GH_TOKEN`.

## The expectation is committed

Each test reads one committed file from `fixtures/` — the repo, the pull
request, the head commit and the check list — and asserts twice against it:
that willfire still predicts that list, and that GitHub still dispatches it.
Tests write nothing.

Two assertions rather than one because they fail for different reasons. A red
on the first says willfire moved; a red on the second says GitHub moved.

Comparing the two live sides against each other instead would miss the case
this suite exists for: if GitHub changes and willfire correctly tracks the
change, both sides move together and a live-against-live assertion stays green.
The committed list is what makes the move visible.

Updating a file is a deliberate commit that acknowledges the move.

## Why the pull requests are fixed

Each test names one pull request and keeps it. Chasing the newest PR shrinks
the window in which GitHub can move without shrinking it to nothing, and it
makes a red unreproducible. Once a suite stops gating, a stable subject is
worth more than a fresh one.

A handful of tests, not a mirror of the integration suite. Each earns its place
by carrying a signal the others do not.
