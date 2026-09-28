`needs-order.yml` holds the same three jobs twice. `needs-first` (a matrix) and
`caller-first` (a reusable call) are declared *above* the `if: false` job they
need; `ctl-needs` and `ctl-caller` are declared below theirs. Run 36430122487
dispatched one skipped check per job in both orders: declaration order changes
nothing.

`statuses.json` carries each dispatched check's conclusion, because six of the
eight names would match even if the verdicts were wrong.

`prt-noop` is the standing `pull_request_target` workflow willfire cannot see
until #356 lands.
