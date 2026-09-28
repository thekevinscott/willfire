R14: a skipped reusable call collapses to one check named after the caller.

Run 36429562835 dispatched `skip-call`, `Named Skip` and `skip-mx`, all `skipped`, and no `<caller> / inner-a` entry for either of the callee's jobs. A `name:` on the calling job wins, and a matrix on it does not expand: `skip-mx` over `cfg: [x, y]` produced one check, not two.
