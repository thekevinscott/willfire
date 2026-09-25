# Integration tests

Recorded responses in, the check list GitHub dispatched out. No network.

## Layout

One directory per case: `fixtures/<owner>/<repo>/<pr>/`. Its `README.md` says
why the case is here, and a subdirectory per covered integration case (`J1`,
`R1`, …) holds that case's README. Those READMEs are the record of what is
covered.

## Fixtures

A captured case is two files — `calls.json`, the recorded `GithubClient`
calls, and `fixture.json`, the dispatched check names — plus sibling `.bin`
files for binary results. `AGENTS.md` here says how to capture one.

Fixtures are recorded live from the GitHub API. Re-record, never edit. An
unrecorded call throws.

Replay substitutes only the `GithubClient`: recorded tarballs stand in for
downloaded repos, and a step the prediction must execute runs in the real
docker sandbox.
