Eight jobs, each guarded by one `github.*` fact seeded from the pull response
(#322), on a PR opened by `thekevinbot` from a same-repo branch into `main`,
one commit, not a draft. GitHub ran `j9-actor-match`, `j9-base-main`,
`j9-not-draft` and `j9-same-repo`, and skipped `j9-actor-miss`,
`j9-base-other`, `j9-is-draft` and `j9-from-fork` — all eight dispatched, so
the fixture holds every name and an entry falling back to `unknown` drops one.

`prt-noop` is the permanent `pull_request_target` no-op on `main` (#338). It
attaches to the PR and is ground truth, but willfire does not model
`pull_request_target` yet (#321), so this case is red on that name alone.
