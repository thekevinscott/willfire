# COERCE — what GitHub does with the expression forms the evaluator refuses

Head SHA `b4efc3f`, one `synchronize` dispatch, ten runs, 46 checks. The label
`skip-ci` is attached, so it is in this dispatch's payload. The `labeled`
activity itself dispatched nothing: at the earlier head every run was created
in one wave at 13:41:16Z and the next wave at 13:41:53Z followed the push, with
nothing in between for the 13:41:37Z labelling — a default-`types:`
`pull_request` or `pull_request_target` workflow does not react to `labeled`.

`statuses.json` is each check's run-or-skipped verdict, derived from its GitHub
conclusion. It is the payload for the comparison cases: the names alone cannot
tell a `true` from a `false`.

## Measured

### Mixed-type comparison — runs 36431899819 (c5) and 36431899972 (c7)

| condition | GitHub |
| --- | --- |
| `'' == 0` | success |
| `'  ' == 0` | success |
| `'1' == 1` | success |
| `'0x1f' == 31` | success |
| `0 == false` | success |
| `null == ''` | success |
| `'2' < 10` | success |
| `'2' >= 2` | success |
| `'10' > 9` | success |
| `'abc' == 0` | skipped |
| `true == 'true'` | skipped |
| `'abc' < 0` | skipped |
| `'abc' > 0` | skipped |
| `'abc' >= 0` | skipped |
| `'abc' != 0` | success |
| `'' != 0` | skipped |
| `true != 'true'` | success |

One rule fits every row: when the two sides differ in type, both are cast to a
number the way JavaScript's `Number` does — a boolean to 1 or 0, empty and
whitespace to 0, `0x1f` to 31, anything else to NaN — and then compared. NaN is
false under `==` and under ordering, and **true** under `!=`, so `!=` stays the
negation of `==`. `'abc' <= 0` is the one direction not dispatched.

`c6 / callee-eq-string` (run 36431900264) is the same rule reached from a
reusable call: a `type: boolean` input passed `true`, guarded by
`inputs.flag == 'true'`, skipped — `1 == NaN`. Its `inputs.flag` twin ran.

### `contains` over an array — runs 36431899839 (c2) and 36431899958 (c8)

| condition | GitHub |
| --- | --- |
| `contains(fromJSON('["a","b"]'), 'a')` | success |
| `contains(fromJSON('["a","b"]'), 'c')` | skipped |
| `contains(fromJSON('["abc"]'), 'ab')` | skipped |
| `contains(fromJSON('[1,2]'), 1)` | success |
| `contains(fromJSON('[1,2]'), '1')` | success |

An element is matched whole, not as a substring, and compared under the same
loose equality `==` uses.

### The label filter — run 36431899807 (c1), with 36431899958 (c8)

`contains(github.event.pull_request.labels.*.name, 'skip-ci')` ran and its
absent-label twin skipped. `contains(..., 'skip')` skipped too: exact on the
star form as well. On the `opened` dispatch before the label existed (run
36430375629) both skipped, so the filter reads the live list. The job
`name: c8-labels-${{ join(github.event.pull_request.labels.*.name, '|') }}`
rendered to `c8-labels-skip-ci`, which pins the array to `["skip-ci"]`.

### Truthiness of a json value — run 36431899773 (c4)

`fromJSON('[1]')`, `fromJSON('[]')` and `fromJSON('{"a":1}')` all ran. An array
or an object is true, empty or not.

### `github.ref` — run 36431899750 (c3)

`startsWith(github.ref, 'refs/pull/')` ran, and a job `name:` interpolating
`github.ref` rendered to `c3-ref-is-refs/pull/383/merge`. On a `pull_request`
run the ref is the merge ref.

### json by instance — run 36431899958 (c8)

`fromJSON('[]') == 0` skipped and `fromJSON('[]') != 0` ran, re-confirming the
rule `compare` already implements.

## Expected red

Thirty-two of the 46 names are missing from the prediction as captured, and
nothing is over-predicted. Two of the thirty-two do not clear with the
expression fixes: `c3-ref-is-refs/pull/383/merge` and `c8-labels-skip-ci` are
rendered from a `name:` that interpolates a seeded `github.*` value, and
`renderName` builds its own scope carrying only `github.event_name`.
`prt-noop` clears with #356.
