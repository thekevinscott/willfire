One `pull_request` workflow (`sf-probe.yml`) plus a `workflow_call` callee
(`sf-callee.yml`), dispatched as run 36430193559 on PR #376's head commit
`4359ac9`:

| job       | guard                            | needs     | conclusion |
| --------- | -------------------------------- | --------- | ---------- |
| `a`       | none                             | —         | success    |
| `b`       | `!cancelled()`                   | `a`       | success    |
| `c`       | `success()`                      | —         | success    |
| `d`       | `failure()`                      | `a`       | skipped    |
| `e`       | `success() \|\| failure()`       | `a`       | success    |
| `f`       | `!cancelled()`, 2-way matrix     | `a`       | success ×2 |
| `g`       | `!cancelled()`, `uses:` callee   | `a`       | success ×2 |
| `skipped` | `if: false`                      | —         | skipped    |
| `h`       | `!cancelled()`, 2-way matrix     | `skipped` | success ×2 |

GitHub created a check run for every one of them, `d` and `skipped` included,
so the name is knowable even where the verdict is not. A matrix expands under
a status guard and a `uses:` job's whole callee tree dispatches under one.

`conclusions.json` is what makes this case bite: before the fix, `b`–`g`
carried `status: "unknown"` and contributed no name at all, and a names-only
fixture would have read the same before and after for `d`, which GitHub
skipped.

`prt-noop` is in the dispatched list because a `pull_request_target` run
attaches to the PR's head commit. willfire cannot see it until #356 lands;
that is the only name this case is red on.
