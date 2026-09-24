# Integration tests

Recorded responses in, the check list GitHub dispatched out. No network.

## Layout

One directory per case: `fixtures/<owner>/<repo>/<pr>/`. Its `README.md` says
why the case is here. Those READMEs are the record of what is covered.

## Fixtures

Fixtures are recorded live from the GitHub API directly. Re-record, never edit.
An unrecorded call throws.

willfire crosses three boundaries — the API, `git clone`, process execution.
All three are substituted, not just the API; `makeLiveExecutor` takes
`remoteUrl` and `runCommand` for that.
