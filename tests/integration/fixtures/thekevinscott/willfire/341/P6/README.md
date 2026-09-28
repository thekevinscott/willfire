# P6: status functions after a skipped need

Closed, unmerged [willfire#341](https://github.com/thekevinscott/willfire/pull/341) is the frozen probe. Its `probe-p6` run [36416679059](https://github.com/thekevinscott/willfire/actions/runs/36416679059) concluded `a` skipped, `b` success, `c` success, and `d` skipped. The jobs use `false`, `${{ !cancelled() }}`, `${{ always() }}`, and `${{ success() || failure() }}` respectively, with `b`, `c`, and `d` needing `a`.

`fixture.json` records every PR-attached check at the head SHA, including `CI Gate` and the `pull_request_target` job `prt-noop`. `statuses.json` records the probe run's GitHub conclusions. `P6.test.ts` checks the prediction's entry statuses because GitHub creates check runs for skipped jobs too: names alone would miss the behavior fixed in #348.
