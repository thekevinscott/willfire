D17: a rename matched against `paths` and against `paths-ignore`.

The PR renames `docs/old.md` to `docs/new.md` and changes nothing else. At head
`02a1469`:

- `r-paths.yml`, `paths: ['docs/old.md']` — run 36430505221
- `r-ignore.yml`, `paths-ignore: ['docs/new.md']` — run 36430505238

Both ran, so GitHub matches a rename against its previous path as well as its
new one: the old path satisfies a `paths:` that names it, and it escapes a
`paths-ignore:` that covers only the new path. willfire feeds both sides into
`ctx.files` and agrees. The `paths-ignore` half had no observation behind it
before this (#367).

Also dispatched: `CI Gate` (pr-monitor.yml) and `prt-noop`
(`pull_request_target`). `prt-noop` is absent from the prediction until #356
lands.
