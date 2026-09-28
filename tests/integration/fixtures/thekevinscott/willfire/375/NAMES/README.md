`tests/fixtures/willrun-probe/.github/workflows/names.yml`, `names-caller.yml`,
`names-mid.yml` and `names-reusable.yml`, copied byte-for-byte onto scratch PR
#375. Between them they cover the literal `name:` plus matrix parenthetical,
expression-name suppression, numeric and object matrix values, `exclude`, the
`include` family, skipped jobs and skipped reusable calls, and caller-segment
naming through one and two levels of local reusable workflow.

GitHub's dispatch at head `6d80003` — runs 36430883584 (`names`), 36430884327
(`names-caller`), 36430880813 (`prt-noop`), 36430883670 (`PR Monitor`) — is
identical, name for name, to the expectations the deleted test recorded from
willrun-probe PR #8.

The fixture is red on three entries, none of them a naming disagreement:

- `ev pull_request` and `p x` each dispatch **twice**. An expression anywhere in
  `name:` suppresses the matrix parenthetical, so two matrix combinations share
  one check name and GitHub creates both. `finalizePrediction` collapses them
  into a `Set`, so the prediction lists each once. Recorded as dispatched.
- `prt-noop` is a `pull_request_target` workflow on the default branch, which
  the prediction cannot see until #356 lands.
