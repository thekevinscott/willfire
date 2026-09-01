# Agent contract

willfire is a pnpm workspace. The published package is at the root: `src/predict.ts`
(the prediction engine and its CLI) and `src/expr/` (a tri-state evaluator for the
slice of the GitHub expression language that job `if:` conditions use).
`README.md` describes the model; this file is the operating contract for working
in the repo.

Each development tool under `scripts/` is its own private workspace package —
`scripts/capture-e2e/` and `scripts/verify/` today. A tool goes there rather
than in `src/` because it is not library surface; it is a package rather than a
loose file so `conventions.yml` reaches it. Every package's sources live at
`<package>/src/` with colocated tests, and every package gets its own
`conventions.yml` call.

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
| `pnpm capture-e2e --repo owner/name --pr N` | re-record one pinned dispatch |

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

- Never pin in workflow YAML — not by SHA, not by tag. Moving tags (`@v0`,
  `@v1`) are the distribution channel for fleet CI conventions; consuming them
  is the point. When a tag move breaks CI, adopt the change or fix forward.
  Freezing the ref is never the fix (ruled on PR #145).
- Smallest reviewable PRs. One concern per PR; split by default.
- Rebase proactively; never ask first. Getting a PR to green is the job, and a
  rebase is not a decision to bring back. Rebase onto the updated base whenever:
  - the branch has a merge conflict,
  - a CI check needs retriggering,
  - a rebase could plausibly turn a check green,
  - commits are unsigned and need re-signing.

## Out of scope

- Don't add unsolicited refactors or hypothetical-future abstractions.
- Don't bypass a CI gate without an explicit reason in the PR body.
- Don't merge PRs. Open the PR, get CI green, and stop — merging is Kevin's
  call, and that includes arming auto-merge.
- No attribution boilerplate. No "Generated with Claude Code" footers, no
  claude.ai links, no session trailers — not in commit messages, PR bodies,
  issues, or docs.
