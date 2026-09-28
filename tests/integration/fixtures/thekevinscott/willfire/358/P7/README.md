A workflow declaring `types: [ready_for_review]`, dispatched by marking a
draft pull request ready.

Head SHA `8722f52` carries two dispatches. Opening the draft fired `opened`
and produced `CI Gate` (pr-monitor.yml), `p7-default` (default `types:`) and
`prt-noop` (`pull_request_target`). Marking the PR ready fired
`ready_for_review` and produced only `p7-ready`; nothing with default `types:`
re-ran, `pull_request_target` included. This fixture is the second dispatch,
named by `action.json`.
