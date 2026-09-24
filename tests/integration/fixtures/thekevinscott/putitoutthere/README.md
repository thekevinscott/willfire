# putitoutthere

Every undecidable case, and the only three-level reusable nesting.

- **R8** — A matrix job that is itself a callee call — rows x callee jobs.
- **R9** — A callee calling another callee — two levels down.
- **R10** — Self-remote `uses:` at a moving tag — `owner/repo/…@v0`, not `./`.
- **U1** — Matrix rows computed from a job output — row count unknowable.
- **U2** — Job `if:` reading a runtime job output — run-or-skip undecidable.
- **U3** — A check name interpolating runtime matrix values.
- **U4** — An undecidable reached through a decidable path — safe from the top.

No pull request identified yet (#255); the capture lands in a `<pr>/` directory here.
