Scratch PR #372, closed unmerged. One `pull_request` dispatch at head SHA
`5251a3e1fffc8e174345f0eab2c0529d8a3e7094`, recorded here. Seven probe
workflows, each a separate file so a startup failure in one cannot be confused
with a failure in another.

Runs at that SHA (`pull_request` and `pull_request_target` kept, `push`
dropped from the expected list but recorded below because two of them are the
finding):

| run | event | file | jobs |
| --- | --- | --- | --- |
| 36431252913 | push | `probe-m1.yml` | **0** — startup failure |
| 36431251563 | push | `probe-m6.yml` | **0** — startup failure |
| 36431257507 | pull_request | `probe-m3.yml` | `m3-sibling`, `m3-wiped` |
| 36431257563 | pull_request | `probe-m4.yml` | the four `m4-readd`, the three `m4-overwrite` |
| 36431257532 | pull_request | `probe-m5.yml` | `build L`, `build` |
| 36431257588 | pull_request | `probe-m7.yml` | `L build`, `build` |
| 36431254086 | pull_request_target | `prt-noop.yml` | `prt-noop` |
| 36431257758 | pull_request | `pr-monitor.yml` | `CI Gate` |

Every name above was read with `cat -A`. None carries edge whitespace.

## M1 — a literal empty matrix axis

```yaml
jobs:
  m1-sibling: { runs-on: ubuntu-latest, steps: [...] }
  m1-empty:
    strategy: { matrix: { a: [] } }
```

GitHub rejects the **file**, not the job. Run 36431252913 concluded with zero
jobs and no `pull_request` run for the file exists at all, so `m1-sibling` got
no check either. willfire predicted `m1-sibling`; fixed in #425.

## M2 — an empty axis that is an expression

Not at this head. `probe-m2.yml` (`fromJSON(needs.m2_gate.outputs.list)`
resolving to `[]`) was removed before the capture, because replaying it costs
a 289 MB tarball recording. Its evidence is run 36430084611 on an earlier head
of the same PR: conclusion `failure`, jobs `m2_gate` and `m2_sibling` only.
Not a startup failure — the axis is evaluated at run time and cancels only its
own job. willfire already answers this correctly. **This sub-case is measured
but not replayable from this fixture.**

## M3 — an `exclude` that removes the whole product

```yaml
m3-wiped:
  strategy: { matrix: { a: [x], exclude: [{ a: x }] } }
```

GitHub schedules the job **once**, under its bare id and with no parenthetical:
`m3-wiped`. It does not cancel the job. willfire predicted zero combinations
and named nothing; fixed in #406.

## M4 — which keys an `include` entry puts in the parenthetical

`m4-readd` is the J11 matrix with `name:` removed, so the parenthetical is not
suppressed. An include entry matching no surviving combination becomes its own
combination and **every** one of its keys shows: `m4-readd (a, 1, x)`.

`m4-overwrite` is `{a: [x, y], b: [p], include: [{a: x, b: q}]}`. An include
that overwrites an axis value creates a new combination beside the product
rather than merging: `(x, p)`, `(x, q)`, `(y, p)`. willfire was already right
both ways.

## M5 / M7 — a name reading a matrix key the combination lacks

`a: [x, y]`, `include: [{a: x, label: L}]`.

- M5, `name: build ${{ matrix.label }}` → `build L` and `build`.
- M7, `name: ${{ matrix.label }} build` → `L build` and `build`.

The absent key substitutes nothing and GitHub trims the result on both sides.
willfire left the name unresolved and nulled `checkName`, dropping the check;
fixed in #427.

## M6 — `matrix` in a job-level `if:`

```yaml
jobs:
  m6-sibling: { runs-on: ubuntu-latest, steps: [...] }
  m6-guarded:
    if: "${{ matrix.label == '' }}"
    strategy: { matrix: { a: [x, y], include: [{ a: x, label: L }] } }
```

Another whole-file startup failure: run 36431251563, zero jobs, no
`pull_request` run. `matrix` is not in scope for a job `if:` and GitHub rejects
the file rather than treating the context as empty. willfire predicts
`m6-sibling` and marks the guarded job unknown — an over-prediction, tracked
in #429. This fixture is red on that name until #429 lands, and on `prt-noop`
until #356 lands.
