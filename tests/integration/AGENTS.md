# Capturing an integration fixture

A fixture is two halves recorded from GitHub in one sitting: every
`GithubClient` call a live prediction made, and the check list GitHub actually
dispatched. The second half is the ground truth the first is measured against,
so it is read from the Actions API, never from willfire's own answer.

`fixtures/<owner>/<repo>/<pr>/fixture.json`:

```json
{
  "dispatched": [
    { "workflow": ".github/workflows/pr-monitor.yml", "name": "CI Gate", "conclusion": "success" }
  ],
  "calls": [{ "method": "getPull", "params": {}, "result": null }]
}
```

Discovery keys on `fixture.json`, so a directory holding only a `README.md` is
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
an unrecorded call throws rather than answering a default.

## Read the dispatched list

Runs hang off the pull request's **head** commit, not the test merge commit
willfire reads workflow files from.

```sh
gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$HEAD_SHA&event=pull_request" \
  --paginate --jq '.workflow_runs[] | "\(.id) \(.path)"'
gh api "repos/$OWNER/$REPO/actions/runs/$RUN_ID/jobs" \
  --paginate --jq '.jobs[] | "\(.name) \(.conclusion)"'
```

One `dispatched` row per job: the run's `path` is `workflow`, the job's `name`
and `conclusion` are the other two.

## Re-record, never edit

A hand-edited fixture asserts what someone believed GitHub would answer. Re-run
the capture and commit what came back.
