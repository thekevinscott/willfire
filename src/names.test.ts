// Check-name resolution, pinned to observed GitHub behaviour.
//
// Every expectation in this file was read back from a live dispatch on
// thekevinbot/willrun-probe PR #8 (`.github/workflows/names.yml` and
// `names-caller.yml`, mirrored under `probe/`). The fixtures below are that
// same YAML; the expected names are the `name` field of the jobs the run
// actually created. Nothing here is inferred from the docs alone.

import assert from "node:assert/strict";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { expandWorkflowJobs } from "./predict.js";

const ctx = { action: "opened", baseRef: "main", files: ["src/app.txt"] };

async function jobs(yaml: string, files: Record<string, string> = {}) {
  const wf = parseYaml(yaml);
  const fetchFile = async (p: string) => files[p] ?? null;
  const entries = await expandWorkflowJobs(wf, ctx, fetchFile);
  return entries.map((e) => ({ job: e.job, checkName: e.checkName, status: e.status }));
}

const nameSet = async (yaml: string, files?: Record<string, string>) =>
  (await jobs(yaml, files)).map((e) => e.checkName).sort();

const NAMES_YML = `
name: names
on: pull_request
jobs:
  plain-job:
    runs-on: ubuntu-latest
  named-job:
    name: Custom Name
    runs-on: ubuntu-latest
  m-auto:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        b: ["1", "2"]
  m-interp:
    name: build \${{ matrix.a }}-\${{ matrix.b }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        b: [p]
  m-static-name:
    name: Static Label
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
  m-numeric:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20.5]
  m-object:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        cfg:
          - { os: linux, arch: x64 }
          - { os: mac, arch: arm64 }
  m-include:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        include:
          - { a: x, extra: e1 }
          - { a: z }
  m-include-only:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - { a: "1" }
          - { a: "2" }
  m-exclude:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        b: [p, q]
        exclude:
          - { a: y, b: q }
  expr-name:
    name: on \${{ github.event_name }}
    runs-on: ubuntu-latest
  m-expr-name:
    name: ev \${{ github.event_name }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
  m-partial-name:
    name: p \${{ matrix.a }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x]
        b: ["1", "2"]
  m-include2:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x]
        include:
          - { a: x, extra: e1 }
          - { a: z, extra: e2 }
  m-include-only2:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - { a: "1", b: one }
          - { a: "2" }
  m-include-noaxis:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        include:
          - { extra: e }
  m-include-overwrite:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
        b: [p]
        include:
          - { a: x, b: q }
  m-skipped:
    if: false
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
  m-skipped-named:
    name: Skipped \${{ matrix.a }}
    if: false
    runs-on: ubuntu-latest
    strategy:
      matrix:
        a: [x, y]
  m-skipped-expr:
    name: sk \${{ github.event_name }}
    if: false
    runs-on: ubuntu-latest
`;

/** The exact job names GitHub created for names.yml on probe PR #8. */
const OBSERVED_NAMES = [
  "Custom Name",
  "Skipped ${{ matrix.a }}",
  "Static Label (x)",
  "Static Label (y)",
  "build x-p",
  "m-skipped",
  "sk ${{ github.event_name }}",
  "build y-p",
  "ev pull_request",
  "ev pull_request",
  "m-auto (x, 1)",
  "m-auto (x, 2)",
  "m-auto (y, 1)",
  "m-auto (y, 2)",
  "m-exclude (x, p)",
  "m-exclude (x, q)",
  "m-exclude (y, p)",
  "m-include (x)",
  "m-include (y)",
  "m-include (z)",
  "m-include-noaxis (x)",
  "m-include-noaxis (y)",
  "m-include-only (1)",
  "m-include-only (2)",
  "m-include-only2 (1, one)",
  "m-include-only2 (2)",
  "m-include-overwrite (x, p)",
  "m-include-overwrite (x, q)",
  "m-include-overwrite (y, p)",
  "m-include2 (x)",
  "m-include2 (z, e2)",
  "m-numeric (18)",
  "m-numeric (20.5)",
  "m-object (linux, x64)",
  "m-object (mac, arm64)",
  "on pull_request",
  "p x",
  "p x",
  "plain-job",
].sort();

test("names.yml resolves to exactly the checks GitHub created", async () => {
  assert.deepEqual(await nameSet(NAMES_YML), OBSERVED_NAMES);
});

test("name: overrides the job id", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  a: { runs-on: ubuntu-latest }
  b: { name: Custom Name, runs-on: ubuntu-latest }
`),
    ["Custom Name", "a"],
  );
});

test("a literal name: still takes the matrix parenthetical", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    name: Static Label
    strategy: { matrix: { a: [x, y] } }
`),
    ["Static Label (x)", "Static Label (y)"],
  );
});

test("any expression in name: suppresses the parenthetical", async () => {
  // Even one that never reads the matrix, and even when that leaves both
  // combinations sharing a single name.
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    name: ev \${{ github.event_name }}
    strategy: { matrix: { a: [x, y] } }
`),
    ["ev pull_request", "ev pull_request"],
  );
});

test("include keys merged into an existing combination stay out of the name", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        a: [x, y]
        include:
          - { a: x, extra: e1 }
`),
    ["j (x)", "j (y)"],
  );
});

test("an include that creates a combination shows all of its keys", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        a: [x]
        include:
          - { a: z, extra: e2 }
`),
    ["j (x)", "j (z, e2)"],
  );
});

test("object matrix values flatten to their own values", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        cfg:
          - { os: linux, arch: x64 }
`),
    ["j (linux, x64)"],
  );
});

test("a name: we cannot evaluate resolves to null, not a guess", async () => {
  assert.deepEqual(
    await jobs(`
jobs:
  j:
    name: build \${{ inputs.flavour }}
    runs-on: ubuntu-latest
`),
    [{ job: "build ${{ inputs.flavour }}", checkName: null, status: "run" }],
  );
});

test("a skipped job collapses to one check with no parenthetical", async () => {
  assert.deepEqual(
    await jobs(`
jobs:
  j:
    if: false
    strategy: { matrix: { a: [x, y] } }
`),
    [{ job: "j", checkName: "j", status: "skipped" }],
  );
});

test("a skipped reusable call keeps its literal name and calls nothing", async () => {
  assert.deepEqual(
    await nameSet(`
jobs:
  j:
    name: Skipped Caller
    if: false
    uses: ./.github/workflows/sub.yml
`),
    ["Skipped Caller"],
  );
});

test("a skipped job's name: is not interpolated at all", async () => {
  // GitHub never sets a skipped job up, so the expression text survives into
  // the check name verbatim — even one we could have evaluated.
  assert.deepEqual(
    await jobs(`
jobs:
  j:
    name: sk \${{ github.event_name }}
    if: false
    runs-on: ubuntu-latest
`),
    [
      {
        job: "sk ${{ github.event_name }}",
        checkName: "sk ${{ github.event_name }}",
        status: "skipped",
      },
    ],
  );
});

test("a dynamic matrix is one unknown entry, not a workflow-wide verdict", async () => {
  assert.deepEqual(
    await jobs(`
jobs:
  fine: { runs-on: ubuntu-latest }
  gen: { runs-on: ubuntu-latest }
  use:
    needs: gen
    strategy:
      matrix:
        item: \${{ fromJSON(needs.gen.outputs.items) }}
`),
    [
      { job: "fine", checkName: "fine", status: "run" },
      { job: "gen", checkName: "gen", status: "run" },
      { job: "use", checkName: null, status: "unknown" },
    ],
  );
});

// ------------------------------------------------------- reusable workflows

const REUSABLE = `
name: names-reusable
on: { workflow_call: {} }
jobs:
  inner:
    runs-on: ubuntu-latest
  inner-named:
    name: Inner Label
    runs-on: ubuntu-latest
  inner-matrix:
    runs-on: ubuntu-latest
    strategy: { matrix: { z: ["1", "2"] } }
`;

const MID = `
name: names-mid
on: { workflow_call: {} }
jobs:
  mid:
    runs-on: ubuntu-latest
  mid-call:
    name: Mid Call
    uses: ./.github/workflows/names-reusable.yml
`;

const CALLER = `
name: names-caller
on: pull_request
jobs:
  call-plain:
    uses: ./.github/workflows/names-reusable.yml
  call-named:
    name: Caller Label
    uses: ./.github/workflows/names-reusable.yml
  call-matrix:
    strategy: { matrix: { v: [a, b] } }
    uses: ./.github/workflows/names-reusable.yml
  call-matrix-named:
    name: cm \${{ matrix.v }}
    strategy: { matrix: { v: [a, b] } }
    uses: ./.github/workflows/names-reusable.yml
  call-nested:
    uses: ./.github/workflows/names-mid.yml
  call-skipped:
    if: false
    uses: ./.github/workflows/names-reusable.yml
  call-skipped-named:
    name: Skipped Caller
    if: false
    uses: ./.github/workflows/names-reusable.yml
`;

const SUB_FILES = {
  ".github/workflows/names-reusable.yml": REUSABLE,
  ".github/workflows/names-mid.yml": MID,
};

/** The exact job names GitHub created for names-caller.yml on probe PR #8. */
const OBSERVED_CALLER = [
  "Caller Label / Inner Label",
  "Caller Label / inner",
  "Caller Label / inner-matrix (1)",
  "Caller Label / inner-matrix (2)",
  "Skipped Caller",
  "call-matrix (a) / Inner Label",
  "call-matrix (a) / inner",
  "call-matrix (a) / inner-matrix (1)",
  "call-matrix (a) / inner-matrix (2)",
  "call-matrix (b) / Inner Label",
  "call-matrix (b) / inner",
  "call-matrix (b) / inner-matrix (1)",
  "call-matrix (b) / inner-matrix (2)",
  "call-nested / Mid Call / Inner Label",
  "call-nested / Mid Call / inner",
  "call-nested / Mid Call / inner-matrix (1)",
  "call-nested / Mid Call / inner-matrix (2)",
  "call-nested / mid",
  "call-plain / Inner Label",
  "call-plain / inner",
  "call-plain / inner-matrix (1)",
  "call-plain / inner-matrix (2)",
  "call-skipped",
  "cm a / Inner Label",
  "cm a / inner",
  "cm a / inner-matrix (1)",
  "cm a / inner-matrix (2)",
  "cm b / Inner Label",
  "cm b / inner",
  "cm b / inner-matrix (1)",
  "cm b / inner-matrix (2)",
].sort();

test("names-caller.yml resolves to exactly the checks GitHub created", async () => {
  assert.deepEqual(await nameSet(CALLER, SUB_FILES), OBSERVED_CALLER);
});

test("an unresolvable caller name nulls the whole callee subtree", async () => {
  assert.deepEqual(
    await jobs(
      `
jobs:
  call:
    name: call \${{ inputs.flavour }}
    uses: ./.github/workflows/names-reusable.yml
`,
      SUB_FILES,
    ),
    [
      { job: "call ${{ inputs.flavour }} / inner", checkName: null, status: "run" },
      { job: "call ${{ inputs.flavour }} / Inner Label", checkName: null, status: "run" },
      {
        job: "call ${{ inputs.flavour }} / inner-matrix (1)",
        checkName: null,
        status: "run",
      },
      {
        job: "call ${{ inputs.flavour }} / inner-matrix (2)",
        checkName: null,
        status: "run",
      },
    ],
  );
});

test("a non-local reusable call is one unknown entry", async () => {
  assert.deepEqual(
    await jobs(`
jobs:
  call:
    uses: some/other/.github/workflows/x.yml@v1
`),
    [{ job: "call", checkName: null, status: "unknown" }],
  );
});
