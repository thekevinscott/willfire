# Agent contract

willfire is a pnpm workspace. The published package is at the root: `src/predict.ts`
(the prediction engine and its CLI), `src/expr/` (a tri-state evaluator for the
slice of the GitHub expression language that job `if:` conditions use), and
`src/verify.ts` (a script that diffs a prediction against what GitHub actually
dispatched). `README.md` describes the model; this file is the operating
contract for working in the repo.

Each development tool under `scripts/` is its own private workspace package —
`scripts/record-cassette/` today. A tool goes there rather than in `src/` because
it is not library surface; it is a package rather than a loose file so
`conventions.yml` reaches it. Every package's sources live at `<package>/src/`
with colocated tests, and every package gets its own `conventions.yml` call.

## Goals

@GOALS.md

## Local commands

| | |
|---|---|
| `pnpm typecheck` | `tsc` over every package's sources, tests included |
| `pnpm test` | Vitest over every package, once |
| `pnpm test:coverage` | Vitest at the 100% floor CI enforces, every package |
| `pnpm lint` | ESLint over every package |
| `pnpm build` | emit `dist/` (tests excluded) |
| `pnpm predict --repo owner/name --pr N` | run the CLI against a live PR |
| `pnpm verify --repo owner/name --pr N` | compare a prediction against reality |
| `pnpm record-cassette --repo owner/name --pr N --shape "…"` | re-record one pinned cassette |

## Testing

Unit tests are **colocated** with their source (`foo.ts` ↔ `foo.test.ts`) at
100% coverage, per the
[testing-conventions](https://github.com/thekevinscott/testing-conventions)
standard, enforced by `.github/workflows/conventions.yml`.

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

## Conventions

- Smallest reviewable PRs. One concern per PR; split by default.

## Out of scope

- Don't add unsolicited refactors or hypothetical-future abstractions.
- Don't bypass a CI gate without an explicit reason in the PR body.
- Don't merge PRs. Open the PR, get CI green, and stop — merging is Kevin's
  call, and that includes arming auto-merge.
- No attribution boilerplate. No "Generated with Claude Code" footers, no
  claude.ai links, no session trailers — not in commit messages, PR bodies,
  issues, or docs.
