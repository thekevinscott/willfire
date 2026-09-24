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
request, the head commit and the check list recorded from a real dispatch —
and asserts that willfire, run live, still produces that list. Tests write
nothing.

The recorded list is the only frozen half. willfire re-reads the repo and
resolves moving tags on every run, so a change on GitHub's side reaches the
prediction and shows up as a red.

Reading the live dispatch back would add nothing. These pull requests are
settled, so their runs are immutable history; asserting against them asserts
that history is still history.

Updating a file is a deliberate commit that acknowledges the move.

## Why the pull requests are fixed

Each test names one pull request and keeps it. Chasing the newest PR shrinks
the window in which GitHub can move without shrinking it to nothing, and it
makes a red unreproducible. Once a suite stops gating, a stable subject is
worth more than a fresh one.

A handful of tests, not a mirror of the integration suite. Each earns its place
by carrying a signal the others do not.
