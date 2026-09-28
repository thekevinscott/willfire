IFCTX: an `if:` reading a context GitHub refuses there fails the whole file at
startup (#378).

Five workflow files, one form each, so no file's failure could mask another:

| file | job | form | run at `f3c21dc` |
| --- | --- | --- | --- |
| `secr-a.yml` | `secr-a-guarded` | job `if: ${{ secrets.X != '' }}` | 36433479173, `push`, failure, 0 jobs |
| `secr-b.yml` | `secr-b-bare` | job `if: secrets.X != ''`, no wrapper | 36433480515, `push`, failure, 0 jobs |
| `secr-c.yml` | `secr-c-step` | step `if: ${{ secrets.X != '' }}` | 36433481828, `push`, failure, 0 jobs |
| `secr-d.yml` | `secr-d-env` | job `if: ${{ env.FOO != '' }}` | 36433483413, `push`, failure, 0 jobs |
| `secr-ok.yml` | `secr-ok-control` | valid control | 36433503746, `pull_request`, success |

Each refused file produced one zero-job `push` failure run and no
`pull_request` run at all, so none of them named a check — not the guarded job
and not the valid sibling job beside it in the same file. `secr-ok.yml` ran
normally, so the refusal is scoped to the file, not the pull request. Wrapping
in `${{ }}` changes nothing, and a step `if:` is refused the same as a job one.

The rest of the PR-attached dispatch: `pr-monitor.yml` run 36433503530
(`CI Gate`) and `prt-noop.yml` run 36433503748 on `pull_request_target`. Every
other workflow in the repo carries a `paths:` filter that
`.github/workflows/secr-*.yml` does not match.

This settles `secrets` at both levels and `env` at job level. `steps`,
`runner`, `job` and `matrix` in a job `if:` are not measured here.
