D15: a `pull_request` trigger setting both a filter and its `-ignore` twin.

`both-branches.yml` declared `branches: [main]` and `branches-ignore: [main]`;
`both-paths.yml` declared `paths: ['**']` and `paths-ignore: ['**']`. Each held
two jobs. Neither produced a `pull_request` run. GitHub hung a startup-failure
run off the `push` that introduced the file instead — runs 36430303598
(`both-branches.yml`) and 36430305268 (`both-paths.yml`), `event: push`,
`conclusion: failure`, **zero jobs each**. A push run is not a PR check, so the
pull request saw nothing from either workflow (#363).

The `opened` dispatch at head `16dc992`, which also produced `CI Gate`
(pr-monitor.yml), `d-default` (bare `on: pull_request:`) and `prt-noop`
(`pull_request_target`). `d-labeled.yml` (`types: [labeled]`) did not run —
the decline side of the default type set (#365). P9 is the `labeled`
dispatch at the same SHA.

`prt-noop` is absent from the prediction until #356 lands.
