# Integration tests

Both sides are frozen: recorded API responses in, the check list GitHub
actually dispatched out. Nothing here touches the network, so this suite gates
every pull request and cannot go red for a reason outside the repo.

## Layout

One directory per case: `fixtures/<owner>/<repo>/<pr>/`. Its `README.md` says
why the case is here.

Its `fixture.json` is a recording, not a hand-written expectation — one PR's
`calls` (`{ method, params, result }` per API call willfire made) beside the
`dispatched` checks GitHub created. Editing one by hand is a claim that
GitHub's behaviour changed; re-record it instead. Every entry is reproducible
with a single `gh api` call against the `method` and `params` it names.

An unrecorded call throws. A new code path that reaches for an endpoint nobody
recorded fails by name rather than silently reading an empty answer.
