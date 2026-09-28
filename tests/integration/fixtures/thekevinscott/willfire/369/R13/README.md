R13: a `uses:` GitHub cannot read takes the whole workflow down, siblings included.

Two workflows each held a broken reusable call beside two ordinary `run: true` jobs — one naming a repo that does not exist (run 36429562730), one naming a local file that is not there (run 36429562502). Both runs concluded `failure` with zero jobs, so neither `sib-a` nor `sib-b` appears here.
