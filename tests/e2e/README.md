# E2e tests

`willfire` runs live against a committed answer. Nothing is mocked.

Few in number. They exist to catch drift — what the API returns, and what a
moving tag now resolves to. A modelling bug is the integration suite's job.

## Layout

One directory per case: `responses/<owner>/<repo>/<pr>/`. Its `fixture.json` is
exactly what willfire returns — the list of check names — recorded from a real
dispatch. Its `README.md` says why the case is here, and those READMEs are the
record of what is covered.
