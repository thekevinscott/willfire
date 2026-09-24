# E2e tests

`willfire` runs live against a committed answer. Nothing is mocked.

Gates nothing, runs on a schedule. A red means GitHub moved — that is the
finding, not a flake.

## Layout

One directory per case: `responses/<owner>/<repo>/<pr>/`. Its `fixture.json` is exactly
what willfire returns — the list of check names — recorded from a real
dispatch. Its `README.md` says why the case is here.

The pull requests are fixed, not the newest. Chasing a fresh one shrinks the
drift window without closing it.

## Cases

Each earns its place by carrying a signal the others do not.

| Repo | The signal a red gives |
| --- | --- |
| github-data-file-fetcher | One check, always. Red means the client or the workflow walk broke — never the model. |
| repo-name-checker | The only `paths-ignore` in the fleet, plus a two-axis matrix. No reusable workflows, so nothing here can drift on its own. |
| template-lib | The canonical fleet shape: path filters, negations, three callers onto a moving tag. Red means the tag moved. |
| testing-conventions | The 61-job local fan-out, and the callee most of the fleet resolves through. |
| putitoutthere | The runtime fan-out. Asserts the decidable entries still match and the undecidable ones are still reported `unknown` rather than guessed. |
