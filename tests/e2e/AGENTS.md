# Capturing an e2e response

`responses/<owner>/<repo>/<pr>/fixture.json` is the `checkNames` array a live
prediction returned, and nothing else:

```sh
pnpm predict --repo "$OWNER/$REPO" --pr "$PR" --json | jq '.checkNames'
```

Only willfire's side is recorded. The prediction itself runs live against live
GitHub every time the suite does.

## Pick the pull request

It is frozen for good. Wait until every run on its head commit has concluded,
then confirm the recorded list against that commit's checks before committing
it — `pnpm predict` answers what willfire believes, which is the thing under
test, not the answer.

```sh
gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$HEAD_SHA&event=pull_request" \
  --paginate --jq '.workflow_runs[].id' \
  | xargs -I{} gh api "repos/$OWNER/$REPO/actions/runs/{}/jobs" --paginate --jq '.jobs[].name'
```

## Re-record deliberately

A red here means GitHub moved. Fix the model, or re-record because the move is
real and understood. Re-recording to clear a red erases the finding.
