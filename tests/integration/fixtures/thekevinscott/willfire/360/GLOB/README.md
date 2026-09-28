Seven workflows, one `paths:` pattern each, against a diff of top-level `.txt`
files plus `gdocs/m.md` and `gother/deep/n.md`. GitHub dispatched `g-star`
(`**/*.txt`) and `g-mid-flat` (`gdocs/**/*.md`), so a `**/` matches zero
directories at the start of a pattern and away from it; it skipped `g-q-any`
(`bb?.txt`) and `g-p-lit` (`d+.txt`), so `?` is zero-or-one and `+` is
one-or-more of the preceding character rather than a wildcard or a literal.

`prt-noop` is in the dispatched list and not in the prediction: `pull_request_target`
workflows are read from the default branch, which willfire does not yet do (#321,
fix in flight as #356). That is the only mismatch.
