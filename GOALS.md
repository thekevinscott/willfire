# Goals

Kevin's design goals for willfire, the gate it feeds, and the repos that gate
runs in. They are settled. Everything else — the agent contract, issue policy,
review practice — is downstream of this file. Changing the list is Kevin's call
alone, and the numbering is stable because issues and reviews cite it.

1. **Exactness.** The prediction is the set of check names GitHub will create,
   character for character, one entry per matrix combination. Not a superset,
   not approximately.
2. **Divergence either direction is red.** No third state, no tolerated
   bucket, no escape hatch.
3. **No repo knowledge in willfire.** It is a general tool. It must not encode
   any consumer's internals — not testing-conventions, not its script paths.
   Mechanism lives in willfire; policy comes from outside.
4. **Never interpret shell.** Don't read `run:` text to infer what it does.
   Run it and capture what comes out.
5. **Execute, don't reimplement.** Where behavior lives as code in another
   repo, run that code at the commit its `uses:` reference resolves to. One
   implementation, two call sites, cannot drift.
6. **Fail closed and honestly.** An entry that cannot be resolved stays
   unresolved and the gate stays red, with a reason naming what failed. Never
   guess to make an entry look decided.
7. **One concern per issue and per PR.**
8. **As little config as possible.** The gate should work by reading what is
   already true, not by being told.
9. **No SHA pins.** Don't pin an action, dependency, or tag to a SHA — not as
   a repair, not to hold a version still. Breakage from upstream is fixed
   forward, in the thing that broke.

## What these rule out

Settled. Don't re-propose them when the gate is red.

- Softening the gate to workflow-file granularity for an unresolvable
  workflow — goal 2.
- Teaching the contract a `prefix / *` wildcard — goal 1.
- Pinning the offending version to get green — goal 9. A red gate is repaired
  upstream, or it stays red and the PR waits.
- Reaching for an execution grant as the reflex repair. A grant is policy from
  outside (goal 3) and it means running that job's real code: a trust decision
  Kevin makes per consumer, never a session. Standing per-repo grant config
  also pulls against goal 8, so deriving grants beats configuring them.

Goal 5 governs which commit's code the executor runs. It is not a license to
pin versions in workflow config; goal 9 governs that.

## Provenance

Goals 1–7 were stated back to Kevin and confirmed 2026-08-20. Goal 8 was added
2026-08-21 ("There is another rule, as little config as possible."), goal 9 on
2026-08-23.
