# Integration tests

Recorded responses in, the check list GitHub dispatched out. No network.

Both sides are frozen, so this suite gates every PR and cannot go red for a
reason outside the repo.

## Layout

One directory per case: `fixtures/<owner>/<repo>/<pr>/`. Its `README.md` says
why the case is here.

## Fixtures

Fixtures are recorded live from the GitHub API directly. Re-record, never edit.
An unrecorded call throws.

willfire crosses three boundaries — the API, `git clone`, process execution.
All three are substituted, not just the API; `makeLiveExecutor` takes
`remoteUrl` and `runCommand` for that.

## Whole-PR tests

One per fleet repo pr-monitor gates. Asserts the complete predicted check list,
so a red says the list differs.

| Repo | What its check list proves | Cases |
| --- | --- | --- |
| UpscalerJS | A repo with no PR trigger predicts an empty set | D1 |
| github-data-file-fetcher | The floor: one unfiltered workflow, one check | D2 |
| skillet | The widest `types:` list in the fleet | D3 |
| steervec | An action-gated check declining, and a dependent skipping with it | D4 J8 |
| lamp-the-djinn | Base-ref gating in both directions | D5 D6 J5 |
| curtaincall | Path filtering both ways, plus the common matrix shape | D7 D8 J3 |
| repo-name-checker | The fleet's only `paths-ignore`, and a cartesian matrix | D9 J4 |
| dirsql | Negation, name interpolation, and input-dependent callees | D10 J6 R4 |
| telelux | A rename matched on its previous path | D11 |
| template-lib | The canonical fleet shape: mixed globs, two callees, a skipped job | D12 J7 R2 R3 |
| willfire | Bare job ids, a moving-tag callee, and three PR-level states | J1 R1 P2 P3 P4 |
| testing-conventions | The 61-job local fan-out the rest of the fleet resolves through | J2 R5 R6 |
| putitoutthere | Every undecidable case, and the only three-level reusable nesting | R8 R9 R10 U1 U2 U3 U4 |
| pr-monitor | A PR whose merge commit exists and is read | P1 |

## Case tests

One per named behaviour, so a red reads as a sentence: `D8 broke`, not `the
list differs`.

| Case | The behaviour it exercises | Repo |
| --- | --- | --- |
| D1 | No `pull_request` trigger — push, schedule or dispatch only | UpscalerJS |
| D2 | Bare `pull_request:` with no filters — always dispatches | github-data-file-fetcher |
| D3 | `types:` includes the PR's action | skillet |
| D4 | `types:` excludes the PR's action — an edited-gated check on a synchronize | steervec |
| D5 | `branches:` matches the base ref | lamp-the-djinn |
| D6 | `branches:` does not match — a PR into a base other than main | lamp-the-djinn |
| D7 | `paths:` with a matching file | curtaincall |
| D8 | `paths:` with no matching file — the dominant reason a check is absent | curtaincall |
| D9 | `paths-ignore:` covers every changed file | repo-name-checker |
| D10 | A negated glob excludes an otherwise-matching file | dirsql |
| D11 | A rename whose previous path matches the filter | telelux |
| D12 | An extension globstar beside a bare path in one list | template-lib |
| J1 | A job with no `name:` — the check takes the job id | willfire |
| J2 | A job with a literal `name:` | testing-conventions |
| J3 | Single-axis static matrix | curtaincall |
| J4 | Two-axis static matrix — the full cartesian product | repo-name-checker |
| J5 | `include:` with no base axis — rows come from include alone | lamp-the-djinn |
| J6 | `name:` interpolating a static matrix value | dirsql |
| J7 | Job-level `if: false` — GitHub still emits a skipped check | template-lib |
| J8 | `needs:` on a job that will be skipped | steervec |
| R1 | Cross-repo callee at a moving tag, resolved live | willfire |
| R2 | Two distinct callee repos in one workflow | template-lib |
| R3 | One callee, several caller jobs, one file — three name prefixes | template-lib |
| R4 | The callee's job set depends on the caller's `with:` inputs | dirsql |
| R5 | Local callee `./.github/workflows/…` — no ref resolution | testing-conventions |
| R6 | Large fan-out onto one local callee — 61 caller jobs | testing-conventions |
| R8 | A matrix job that is itself a callee call — rows × callee jobs | putitoutthere |
| R9 | A callee calling another callee — two levels down | putitoutthere |
| R10 | Self-remote `uses:` at a moving tag — `owner/repo/…@v0`, not `./` | putitoutthere |
| U1 | Matrix rows computed from a job output — row count unknowable | putitoutthere |
| U2 | Job `if:` reading a runtime job output — run-or-skip undecidable | putitoutthere |
| U3 | A check name interpolating runtime matrix values | putitoutthere |
| U4 | An undecidable reached through a decidable path — safe from the top | putitoutthere |
| P1 | A merge commit exists — read the tree there, not at head | pr-monitor |
| P2 | No merge commit — fall back to head | willfire |
| P3 | `[skip ci]` in the head commit message suppresses the dispatch | willfire |
| P4 | A workflow present in the tree but disabled in the Actions tab | willfire |

Two of the 39 enumerated cases are not integration cases. R7 — a moving tag
gaining a job between two reads — dissolves once both sides are frozen. P5 — an
unreadable workflow file — has no live counterpart to record.
