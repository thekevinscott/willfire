# willrun-probe

Probe repo for verifying GitHub Actions dispatch prediction. Each workflow
exercises one dispatch rule; PRs are opened by a bot to test predictions
against what GitHub actually runs. See the parent project for the predictor.

Two families of workflow live here:

- **Dispatch probes** — `paths.yml`, `branches.yml`, `types.yml`, `negation.yml`
  and friends. These answer "does this workflow fire at all?"
- **Check-name probes** — `names.yml`, `names-caller.yml`, `names-mid.yml`,
  `names-reusable.yml`. These answer "what is the resolved name of each check
  it creates?" Between them they cover `name:` overrides, matrix parenthetical
  formation, `include`/`exclude`, numeric and object matrix values, skipped
  jobs, and one-, two- and three-level reusable workflow calls.

The check-name probes are the ground truth behind willfire's
`src/names.test.ts`: every expectation in that file is a job name read back
off a live dispatch here, not a reading of the docs. When a name-resolution
rule is in question, add a job to `names.yml`, push, and read the answer out
of `actions/runs/<id>/jobs`.
