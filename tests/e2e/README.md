# E2e tests

`willfire` runs live against a committed answer. Nothing is mocked.

## Layout

One directory per case: `responses/<repo>/<pr>/`. Its `fixture.json` is exactly
what willfire returns — the list of check names — recorded from a real
dispatch. Its `README.md` says why the case is here.
