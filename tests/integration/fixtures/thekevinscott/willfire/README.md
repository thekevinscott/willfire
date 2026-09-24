# willfire

Bare job ids, a moving-tag callee, and three PR-level states.

- **J1** — A job with no `name:` — the check takes the job id.
- **R1** — Cross-repo callee at a moving tag, resolved live.
- **P2** — No merge commit — fall back to head.
- **P3** — `[skip ci]` in the head commit message suppresses the dispatch.
- **P4** — A workflow present in the tree but disabled in the Actions tab.

P2, P3 and P4 are real consumer states that would take a long time to occur
on their own, so #255 produces them as transient pull requests against this
repo rather than waiting.

No pull request identified yet (#255); the capture lands in a `<pr>/` directory here.
