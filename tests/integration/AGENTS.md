# Capturing an integration fixture

A capture is two recordings taken from GitHub in one sitting, landed in
`fixtures/<owner>/<repo>/<pr>/`:

- `calls.json` — every `GithubClient` call a live prediction made, verbatim.
- `fixture.json` — the check names GitHub actually dispatched: a bare JSON
  array of strings, deduplicated and sorted. Ground truth, read from the
  Actions API, never from willfire's own answer. Same format as
  `tests/e2e/responses/`; both suites load it through `tests/getResponse.ts`.

```json
["CI Gate", "conventions / Static checks (typescript)"]
```

JSON has no `ArrayBuffer`, so a binary result (`downloadTarball`) is recorded
in `calls.json` as `{ "$binary": "tarball-0.bin" }` with the bytes in a
sibling file; `getCalls` reads the reference back into an `ArrayBuffer` at
replay, and a missing sibling fails loudly.

Discovery keys on `fixture.json`, so a directory holding only READMEs is
inert until the capture lands.

## Pick the pull request

It is frozen for good: the case is that pull request, not the repo's newest.
Wait until every run on its head commit has concluded — a capture taken
mid-run records a short list and pins it.

## Record the calls

Wrap the real client and keep what goes through it.

```ts
const real = makeGithubClient();
const calls: RecordedCall[] = [];
const recording = new Proxy(real, {
  get: (t, method: string) => async (params: never) => {
    const result = await (t as Record<string, (p: never) => Promise<unknown>>)[method](params);
    calls.push({ method, params, result });
    return result;
  },
});
await predict(recording, `${owner}/${repo}`, pr);
```

Record `params` exactly as passed. `replayClient` keys on the method plus its
params sorted by key, so property order cannot decide whether a lookup hits;
an unrecorded call throws rather than answering a default. Before writing
`calls.json`, swap each `ArrayBuffer` result for a `$binary` reference and
write the bytes beside it.

## Read the dispatched list

Runs hang off the pull request's **head** commit, not the test merge commit
willfire reads workflow files from. No `event=` filter: filtering to
`pull_request` drops `pull_request_target`, `push`, and `merge_group` runs.

```sh
gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$HEAD_SHA" \
  --paginate --jq '.workflow_runs[].id'
gh api "repos/$OWNER/$REPO/actions/runs/$RUN_ID/jobs" \
  --paginate --jq '.jobs[].name'
```

`fixture.json` is those job names, deduplicated and sorted.

## Re-record, never edit

A hand-edited fixture asserts what someone believed GitHub would answer. Re-run
the capture and commit what came back.
