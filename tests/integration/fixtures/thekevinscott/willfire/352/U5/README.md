Two callers guard `uses: ./.github/workflows/probe-u5-callee.yml` with a
condition willfire cannot decide.

`secrets` is not an available context in a job-level `if:`, so GitHub rejected
`probe-u5.yml` at startup: the only run for it is a `push`-event run with
conclusion `failure` and zero jobs, dropped from the ground truth by the
event rule in the capture recipe. The shape issue #328 named for U5 is not a
valid workflow.

`vars` is available, so `probe-u5-vars.yml` is valid. The repository has no
`WILLFIRE_U5_ABSENT` variable, so `vars.WILLFIRE_U5_ABSENT != ''` was false and
GitHub skipped the call — dispatching a job named `callvars`, the caller, not
`callvars / inner`. Had the variable been set, the same file would have
dispatched `callvars / inner` and no `callvars`.

Red: willfire predicts neither name. Since #343 an undecided caller stops with
`checkName: null`, so the callee never surfaces — correct as far as it goes,
but the caller's own name is missing, and the two outcomes the guard selects
between are different check sets, not one set minus a callee. `prt-noop` is
missing for a separate reason: `pull_request_target` is not modelled (#321).
