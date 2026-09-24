# Agent contract

willfire is a pnpm workspace. The published package is at the root: `src/predict.ts`
(the prediction engine and its CLI) and `src/expr/` (a tri-state evaluator for the
slice of the GitHub expression language that job `if:` conditions use).
`README.md` describes the model; this file is the operating contract for working
in the repo.

Each development tool under `scripts/` is its own private workspace package —
`scripts/verify/` today. A tool goes there rather
than in `src/` because it is not library surface; it is a package rather than a
loose file so `conventions.yml` reaches it. Every package's sources live at
`<package>/src/` with colocated tests, and every package gets its own
`conventions.yml` call.

## Goals

@GOALS.md

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

## e2e attestations

A PR touching `src/**` lands a receipt in `e2e-attestations/` recording the
command actually run and its real exit code.
`tests/integration/attestations.test.ts` fails the suite on a nonzero one. Run
it unpiped: `| tail` makes the shell report the pipe's status, and a receipt
recording `exit_code: 0` for a run that printed `3 failed` defeats that check
outright.

Never copy the previous receipt's `-t` exclusion forward unexamined. An
exclusion is a standing claim that the excluded case still fails for a known
reason, and that claim decays: the `willfire#34` term rode 45 receipts over
three weeks while the reason recorded for it was superseded and no open issue
tracked it. Re-run each excluded case and drop the term if it passes. If it
still fails, name the open issue tracking it in the commit that adds the
receipt — an exclusion with no open issue is how they accumulate (#181).

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

A PR body claiming the consumer is unaffected cites the command that
established it — a `gh api` read of its call sites, or a grep. Reasoning from
how the API is constructed is not a check; #174 reasoned that way and missed a
live call site.

## Conventions

- Never pin in workflow YAML — not by SHA, not by tag. Moving tags (`@v0`,
  `@v1`) are the distribution channel for fleet CI conventions; consuming them
  is the point. When a tag move breaks CI, adopt the change or fix forward.
  Freezing the ref is never the fix (ruled on PR #145).
- A change to the published API surface carries a bump-level trailer.
  putitoutthere reads `release: <patch|minor|major|skip>` from the merge
  commit, falling back to the merged branch's tip commit — so write it into
  the last commit on the branch. Without it every release is a patch, and at
  `0.x` a breaking change ships inside the consumer's caret range.
- Smallest reviewable PRs. One concern per PR; split by default.
- Rebase proactively; never ask first. Getting a PR to green is the job, and a
  rebase is not a decision to bring back. Rebase onto the updated base whenever:
  - the branch has a merge conflict,
  - a CI check needs retriggering,
  - a rebase could plausibly turn a check green,
  - commits are unsigned and need re-signing.

## Session handoff doc

Maintain one ongoing handoff doc per working session and deliver it to the user
as a downloadable markdown file at every **stopping point**: after each major
unit of work lands (a push, an observed red or green CI run, a merged PR, a
finished investigation) or when blocked on user input. A stopping point marks a
checkpoint, not the end — send the doc, then keep working.

The doc is conversation-scoped: keep it in the session scratchpad or `/tmp`
(e.g. `<scratchpad>/handoff.md`), outside the repo tree, and keep it out of
every commit. Update the same doc in place and re-send it at each checkpoint
(in hosted sessions, attach it via the file-delivery tool; locally, print its
path), so the freshest copy sits near the bottom of the conversation.

Write it standalone, so a brand-new session with zero context resumes from it
alone:

- Task and current status (done / in progress / next)
- Branches, PRs, and issues with numbers and CI state
- Key decisions and discovered constraints, with one-line reasons
- Exact next steps, including commands to run
- Anything waiting on the user
- Every claim labelled **measured** (you ran it and read the output) or
  **agent-reported** (a subagent told you)
- Corrections to the previous handoff, first in the doc — handoffs here have
  propagated wrong "verified" claims before

Purpose: the prompt cache survives at most an hour of inactivity, so resuming a
long conversation after hours away reprocesses the entire history at full cost.
A current handoff doc near the end of the transcript lets the user scroll up,
grab it, and start a cheap fresh session from the doc instead of resuming the
stale one.

## Out of scope

- Don't add unsolicited refactors or hypothetical-future abstractions.
- Don't bypass a CI gate without an explicit reason in the PR body.
- Don't merge PRs. Open the PR, get CI green, and stop — merging is Kevin's
  call, and that includes arming auto-merge.
- No attribution boilerplate. No "Generated with Claude Code" footers, no
  claude.ai links, no session trailers — not in commit messages, PR bodies,
  issues, or docs.
