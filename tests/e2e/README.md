# E2e tests

Both sides are live: predict against GitHub now, read what GitHub dispatched
now, compare. Nothing frozen is compared against anything current, so the drift
that turns a stale expectation red cannot reach this suite.

**This suite gates nothing.** It runs on a schedule. A red means GitHub moved,
which is the finding rather than a flake, and it must never block a merge —
that is what the integration suite is for.

Run it with `pnpm test:e2e`. It needs `GH_TOKEN`.

## The fixture files are records, not expectations

Each test writes what it observed to `fixtures/`: the repo, the pull request,
the head commit, the predicted names and the dispatched names. Nothing reads
these files back as an assertion — the assertion is live against live.

They exist so drift arrives as a diff in version control that someone reads.
When a run changes one, the change is the signal; committing it is how you
acknowledge the move.

## Why the pull requests are fixed

Each test names one pull request and keeps it. Chasing the newest PR shrinks
the window in which GitHub can move without shrinking it to nothing, and it
makes a red unreproducible. Once a suite stops gating, a stable subject is
worth more than a fresh one.

A handful of tests, not a mirror of the integration suite. Each earns its place
by carrying a signal the others do not.
