D16: `branches:` declining, and `branches-ignore:` at all, on a non-`main` base.

Three workflows, base `probe-base`, head `05fd712`:

- `b-main.yml`, `branches: [main]` — no run
- `b-probe.yml`, `branches: [probe-base]` — run 36430422967
- `bi-probe.yml`, `branches-ignore: [probe-base]` — no run

So a `branches:` missing the base declines, and a `branches-ignore:` covering
it declines. Both had only ever been a docs read: every earlier recording bases
on `main` and every captured `branches:` is `[main]` (#364).

Also dispatched: `CI Gate` (pr-monitor.yml) and `prt-noop`
(`pull_request_target`, read from the base branch). `prt-noop` is absent from
the prediction until #356 lands.
