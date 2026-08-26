# Goals

`willfire` is a library whose sole purpose is to calculate the set of checks that will run in Github CI. It only exists because Github CI fails to provide this information themselves.

Design goals for `willfire` include:

1. **Exactness.** The prediction includes exactly the set of CI checks that GitHub CI will run, including one entry per matrix combination, exposed as a list of strings.
2. **No repo knowledge in willfire.** `willfire` is a general tool and must not encode any consumer's internals or repositories.
3. **No configuration required.**
