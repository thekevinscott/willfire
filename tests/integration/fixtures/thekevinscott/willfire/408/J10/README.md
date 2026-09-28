J10: job guards on `vars.*`, decided from the repo's variable listing (#351).

Scratch PR #408, head `b7e4444`, four independent workflows. The repo variable
`RUN_EXTRA=true` was the only variable in
`repos/thekevinscott/willfire/actions/variables` at capture time;
`WF_J10_ABSENT` was deliberately not one.

| workflow | guard | run | GitHub |
| --- | --- | --- | --- |
| `probe-j10-true` | `vars.RUN_EXTRA == 'true'` | 36433468790 | `vars-eq-true` success |
| `probe-j10-false` | `vars.RUN_EXTRA == 'false'` | 36433468750 | `vars-eq-false` skipped |
| `probe-j10-unset-empty` | `vars.WF_J10_ABSENT == ''` | 36433468924 | `unset-eq-empty` success |
| `probe-j10-unset-truthy` | `vars.WF_J10_ABSENT` | 36433468534 | `unset-truthy` skipped |

An undefined `vars.X` resolves to the empty string, measured on both sides: the
comparison against `''` is true and the bare name is falsey. A skipped job still
gets a check run, so `J10.test.ts` asserts `entries[].status` against those
conclusions — `fixture.json` alone cannot tell a run from a skip.

Both fixtures are red, in the under-predicting direction:

- `unset-eq-empty` and `unset-truthy` are `unknown` to willfire, because #351
  leaves a name the listing does not carry undecided. #418 tracks narrowing that.
- `prt-noop` is dispatched on `pull_request_target`, which willfire does not
  read yet. #356 tracks it.

The prediction made exactly one `listRepoVariables` call for all four workflows.
