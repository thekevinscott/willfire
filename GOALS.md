# Goals

`willfire` is a library whose sole purpose is to calculate the set of checks that will run in Github CI. It only exists because Github CI fails to provide this information themselves.

Design goals for `willfire` include:

1. **Exactness.** The prediction includes exactly the set of CI checks that GitHub CI will run, including one entry per matrix combination, exposed as a list of strings.
2. **No repo knowledge in willfire.** `willfire` is a general tool and must not encode any consumer's internals or repositories.
3. **No configuration required.**
4. **Speed.** The job should execute as fast as is possible. Instant is ideal, and should be strived for.
5. **No rendering of dynamic lists to static artifacts.** A runtime-computed value (a matrix, a job output) is computed at prediction time or reported `unknown` — never snapshotted into a committed artifact and read back. Snapshots drift, and a stale one produces a confidently wrong prediction instead of an honest `unknown`.
6. **One level of configuration.** Anything a consumer configures is declared in exactly one place. A config artifact at one level that only takes effect because of a declaration at another — an `eslint.json` in a repo that never declares eslint as a dependency — is two levels, and forbidden.
