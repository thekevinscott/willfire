# Integration tests

Both sides are frozen: recorded API responses in, the check list GitHub
actually dispatched out. Nothing here touches the network, so this suite gates
every pull request and cannot go red for a reason outside the repo.

## The two kinds of test

A **whole-PR test** asserts the complete predicted check list for one real pull
request. It catches anything; a red only says the list differs.

A **case test** asserts one named behaviour — `D2`, `J7`, `R4`. It catches less;
a red says which behaviour broke. The case names come from the enumeration of
prediction shapes the gated fleet actually produces.

One whole-PR test per fleet repo, one case test per case.

## Hermetic means all three boundaries

willfire crosses three boundaries out of the repo: the GitHub API, `git clone`,
and process execution for running a job's steps. `replayClient` substitutes the
first. The other two are reached only when a workflow has a runtime-computed
matrix, which forces willfire to actually run a job; those tests substitute
them through `makeLiveExecutor`'s `remoteUrl` and `runCommand` options.

Docker is deliberately not exercised here. The sandbox is tested where it
lives, under `src/sandbox/`.

## Fixtures

A fixture is a recording, not a hand-written expectation. Each is one PR's
`calls` — `{ method, params, result }` per API call willfire made — beside the
`dispatched` checks GitHub created.

Editing one by hand is a claim that GitHub's behaviour changed. Re-record it
instead. Every entry is reproducible with a single `gh api` call against the
`method` and `params` it names.

An unrecorded call throws. A new code path that reaches for an endpoint nobody
recorded fails by name rather than silently reading an empty answer.
