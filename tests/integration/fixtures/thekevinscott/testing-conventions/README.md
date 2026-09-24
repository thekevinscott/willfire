# testing-conventions

The 61-job local fan-out the rest of the fleet resolves through.

- **J2** — A job with a literal `name:`.
- **R5** — Local callee `./.github/workflows/…` — no ref resolution.
- **R6** — Large fan-out onto one local callee — 61 caller jobs.

No pull request identified yet (#255); the capture lands in a `<pr>/` directory here.
