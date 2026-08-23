# Goals

Design goals for willfire. Everything else is downstream of these goals.

1. **Exactness.** The prediction is exactly the set of check names GitHub will create, character for character, one entry per matrix combination.
2. **Divergence either direction is red.** No third state, no tolerated
   bucket, no escape hatch.
3. **No repo knowledge in willfire.** `willfire` is a general tool and must not encode any consumer's internals. No hard coded repositories.
4. **Never interpret shell.** Don't read `run:` text to infer what it does. Run it and capture what comes out. Where behavior lives as code in another repo, run that code at the commit its `uses:` reference resolves to.
5. **Fail closed and honestly.** An entry that cannot be resolved stays
   unresolved and the gate stays red, with a reason naming what failed. Never
   guess to make an entry look decided.
6. **As little config as possible.** If the tool can be designed in such a way as to not require config, that is preferred. The best is no config, the second best is as little as possible.
7. **No SHA pins.** Never pin an action, dependency, or tag to a SHA.

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
