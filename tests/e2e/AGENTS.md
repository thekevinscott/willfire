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

Enumerate every run for the head SHA — a bare `event=pull_request` filter
drops `pull_request_target` runs — then keep by event. willfire predicts the
PR-attached check set: `pull_request` and `pull_request_target` runs are in;
`push` runs on the PR branch do not attach to the PR and are out.

```sh
gh api "repos/$OWNER/$REPO/actions/runs?head_sha=$HEAD_SHA" \
  --paginate \
  --jq '.workflow_runs[] | select(.event == "pull_request" or .event == "pull_request_target") | .id' \
  | xargs -I{} gh api "repos/$OWNER/$REPO/actions/runs/{}/jobs" --paginate --jq '.jobs[].name'
```

## Re-record deliberately

A red here means GitHub moved. Fix the model, or re-record because the move is
real and understood. Re-recording to clear a red erases the finding.
