# github-data-file-fetcher#3

The simplest dispatch in the fleet: two workflows, one check.

- **D1** — `docs.yml` has no `pull_request` trigger, so it does not dispatch.
- **D2** — `pr-monitor.yml` has a bare `pull_request` trigger, so it runs.

Result: `["CI Gate"]`. No matrix, no reusable workflow, no `if:` condition.

Read at the merge commit rather than head, which is the default path.
