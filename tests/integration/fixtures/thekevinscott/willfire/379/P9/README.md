P9: the `labeled` activity type, the decline side of `DEFAULT_TYPES`.

Applying a label to scratch PR #379 dispatched `d-labeled.yml`
(`types: [labeled]`) and nothing else — run 36430659796 at head `16dc992`,
created 13:43:38Z, three minutes after the `opened` batch at 13:40:51Z.
`d-default.yml` (bare `on: pull_request:`) did not re-run, nor did
`pr-monitor.yml`, nor `prt-noop.yml` on `pull_request_target`. So `labeled` is
outside the default type set, measured on both sides: it fires a workflow that
names it and fires nothing that does not (#365).

This settles `labeled` alone. The other eighteen non-default activity types
remain a docs read.

D15 is the `opened` dispatch at the same SHA.
