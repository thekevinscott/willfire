# Agent contract

willfire is one TypeScript package: `src/predict.ts` (the prediction engine and
its CLI), `src/expr.ts` (a tri-state evaluator for the slice of the GitHub
expression language that job `if:` conditions use), and `src/verify.ts` (a
script that diffs a prediction against what GitHub actually dispatched). `README.md` describes the model; this file is the
operating contract for working in the repo.

## Local commands

| | |
|---|---|
| `pnpm typecheck` | `tsc` over `src/`, tests included |
| `pnpm test` | Vitest, once |
| `pnpm test:coverage` | Vitest at the 100% floor CI enforces |
| `pnpm build` | emit `dist/` (tests excluded) |
| `pnpm predict --repo owner/name --pr N` | run the CLI against a live PR |
| `pnpm verify --repo owner/name --pr N` | compare a prediction against reality |

## Testing

Unit tests are **colocated** with their source (`foo.ts` ↔ `foo.test.ts`) at
100% coverage, per the
[testing-conventions](https://github.com/thekevinscott/testing-conventions)
standard, enforced by `.github/workflows/conventions.yml`. Thresholds and any
exemptions live in `testing-conventions.toml`; an exemption needs a written
reason, and the bar is high — `verify.ts` is a top-level script and still gets
driven end to end by its colocated test rather than waived.

The expectations in `src/predict.test.ts` are **not** opinions about how GitHub
ought to behave. Every workflow-level verdict was read off a live dispatch on
[willrun-probe](https://github.com/thekevinbot/willrun-probe); the workflows
under `tests/fixtures/willrun-probe/` are the record, and `setup-probe.sh` pushes
them. Changing one of those assertions is a claim that GitHub's behavior
changed — verify it against a real PR before you do.

`unknown` is the honest answer for anything undecidable from the workflow files
alone (a runtime-computed matrix, a cross-repo reusable workflow). Do not guess
in order to make an entry look decided. It is job-level only: `Entry` is a
closed union and the workflow-level variant has no `unknown`, because every
workflow-level verdict is decidable. Do not widen it back.

## Comments

A comment earns its place by stating what the code cannot: a constraint, a
workaround's cause, a verified external behavior. One or two lines. No
narrative comments, no doc-comment essays, no restating the diff or the PR
description. When in doubt, delete it.

## Consumers

`thekevinscott/pr-monitor` gates the fleet on willfire's predicted run set. A
prediction that is wrong in the over-predicting direction hangs a gate; one that
is wrong in the under-predicting direction opens a silent hole. Treat a change to
verdict logic as a change to every gated repo.

## Out of scope

- Don't add unsolicited refactors or hypothetical-future abstractions.
- Don't bypass a CI gate without an explicit reason in the PR body.
- Don't merge PRs. Open the PR, get CI green, and stop — merging is Kevin's
  call, and that includes arming auto-merge.
