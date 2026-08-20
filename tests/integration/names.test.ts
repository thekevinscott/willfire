// Check-name resolution, pinned to observed GitHub behaviour.
//
// Every expectation in this file was read back from a live dispatch on
// thekevinbot/willrun-probe: PR #8 for `.github/workflows/names.yml` and
// `names-caller.yml`, PR #9 for `remote-caller.yml` (all mirrored under
// `tests/fixtures/willrun-probe/`). The fixtures below are that same YAML; the
// expected names are the `name` field of the jobs the run actually created.
// Nothing here is inferred from the docs alone.

import { expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { expandWorkflowJobs, parseUses, type WorkflowSource } from "../../src/predict.js";

const ctx = { action: "opened", baseRef: "main", files: ["src/app.txt"] };

/** The probe repo at the PR head — the repo and ref expansion starts from. */
const HEAD: WorkflowSource = {
  owner: "thekevinbot",
  repo: "willrun-probe",
  ref: "headsha",
};

/**
 * A workflow file's full address. Fixtures key on this rather than on a bare
 * path so a lookup that resolves against the wrong repo or the wrong ref
 * misses instead of quietly finding the caller's copy.
 */
const at = (source: WorkflowSource, path: string) =>
  `${source.owner}/${source.repo}/${path}@${source.ref}`;

/** Address a file in the probe repo at head, the way a local `./` call does. */
const local = (path: string) => at(HEAD, path);

async function jobs(yaml: string, files: Record<string, string> = {}) {
  const wf = parseYaml(yaml);
  const fetchWorkflow = async (p: string, source: WorkflowSource) =>
    files[at(source, p)] ?? null;
  const entries = await expandWorkflowJobs(wf, ctx, fetchWorkflow, HEAD);
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
  expect(await nameSet(NAMES_YML)).toEqual(OBSERVED_NAMES);
});

test("name: overrides the job id", async () => {
  expect(await nameSet(`
jobs:
  a: { runs-on: ubuntu-latest }
  b: { name: Custom Name, runs-on: ubuntu-latest }
`)).toEqual(["Custom Name", "a"]);
});

test("a literal name: still takes the matrix parenthetical", async () => {
  expect(await nameSet(`
jobs:
  j:
    name: Static Label
    strategy: { matrix: { a: [x, y] } }
`)).toEqual(["Static Label (x)", "Static Label (y)"]);
});

test("any expression in name: suppresses the parenthetical", async () => {
  // Even one that never reads the matrix, and even when that leaves both
  // combinations sharing a single name.
  expect(await nameSet(`
jobs:
  j:
    name: ev \${{ github.event_name }}
    strategy: { matrix: { a: [x, y] } }
`)).toEqual(["ev pull_request", "ev pull_request"]);
});

test("include keys merged into an existing combination stay out of the name", async () => {
  expect(await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        a: [x, y]
        include:
          - { a: x, extra: e1 }
`)).toEqual(["j (x)", "j (y)"]);
});

test("an include that creates a combination shows all of its keys", async () => {
  expect(await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        a: [x]
        include:
          - { a: z, extra: e2 }
`)).toEqual(["j (x)", "j (z, e2)"]);
});

test("object matrix values flatten to their own values", async () => {
  expect(await nameSet(`
jobs:
  j:
    strategy:
      matrix:
        cfg:
          - { os: linux, arch: x64 }
`)).toEqual(["j (linux, x64)"]);
});

test("a name: we cannot evaluate resolves to null, not a guess", async () => {
  expect(await jobs(`
jobs:
  j:
    name: build \${{ inputs.flavour }}
    runs-on: ubuntu-latest
`)).toEqual([{ job: "build ${{ inputs.flavour }}", checkName: null, status: "run" }]);
});

test("a skipped job collapses to one check with no parenthetical", async () => {
  expect(await jobs(`
jobs:
  j:
    if: false
    strategy: { matrix: { a: [x, y] } }
`)).toEqual([{ job: "j", checkName: "j", status: "skipped" }]);
});

test("a skipped reusable call keeps its literal name and calls nothing", async () => {
  expect(await nameSet(`
jobs:
  j:
    name: Skipped Caller
    if: false
    uses: ./.github/workflows/sub.yml
`)).toEqual(["Skipped Caller"]);
});

test("a skipped job's name: is not interpolated at all", async () => {
  // GitHub never sets a skipped job up, so the expression text survives into
  // the check name verbatim — even one we could have evaluated.
  expect(await jobs(`
jobs:
  j:
    name: sk \${{ github.event_name }}
    if: false
    runs-on: ubuntu-latest
`)).toEqual([
      {
        job: "sk ${{ github.event_name }}",
        checkName: "sk ${{ github.event_name }}",
        status: "skipped",
      },
    ]);
});

test("a dynamic matrix is one unknown entry, not a workflow-wide verdict", async () => {
  expect(await jobs(`
jobs:
  fine: { runs-on: ubuntu-latest }
  gen: { runs-on: ubuntu-latest }
  use:
    needs: gen
    strategy:
      matrix:
        item: \${{ fromJSON(needs.gen.outputs.items) }}
`)).toEqual([
      { job: "fine", checkName: "fine", status: "run" },
      { job: "gen", checkName: "gen", status: "run" },
      { job: "use", checkName: null, status: "unknown" },
    ]);
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
  [local(".github/workflows/names-reusable.yml")]: REUSABLE,
  [local(".github/workflows/names-mid.yml")]: MID,
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
  expect(await nameSet(CALLER, SUB_FILES)).toEqual(OBSERVED_CALLER);
});

test("an unresolvable caller name nulls the whole callee subtree", async () => {
  expect(await jobs(
      `
jobs:
  call:
    name: call \${{ inputs.flavour }}
    uses: ./.github/workflows/names-reusable.yml
`,
      SUB_FILES,
    )).toEqual([
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
    ]);
});

// --------------------------------------------- remote (cross-repo) reusables

/**
 * The `owner/repo/path@ref` form, pinned to probe PR #9
 * (`.github/workflows/remote-caller.yml`, mirrored under the fixture tree).
 *
 * The probe is built so the answers cannot be guessed. `remote-reusable.yml`
 * and `remote-inner.yml` exist at three refs that deliberately disagree:
 *
 *   tag `remote-v0` / its SHA -> `r-inner`,          `deep-at-v0`
 *   branch `main`             -> `r-inner-at-main`,  `deep-at-main`
 *   the PR head               -> (same as main)
 *
 * so the job name that shows up in a check says which ref GitHub read, and
 * the fixtures below key on the full `owner/repo/path@ref` address for the
 * same reason: a lookup that resolves against the wrong ref finds the wrong
 * file rather than quietly finding the right one.
 */
const remoteReusable = (innerJob: string) => `
name: remote-reusable
on:
  workflow_call:
    inputs:
      tag: { type: string, required: false, default: "" }
jobs:
  ${innerJob}:
    runs-on: ubuntu-latest
  r-named:
    name: Remote Label
    runs-on: ubuntu-latest
  r-matrix:
    runs-on: ubuntu-latest
    strategy: { matrix: { z: ["1", "2"] } }
  r-call-local:
    name: Remote Local Call
    uses: ./.github/workflows/remote-inner.yml
`;

const remoteInner = (job: string) => `
name: remote-inner
on: { workflow_call: {} }
jobs:
  ${job}:
    runs-on: ubuntu-latest
`;

/** The SHA `remote-v0` points at, spelled out the way the probe caller does. */
const V0_SHA = "085aa5927d7ac296cc6e740713ef5b1a7e20d6b7";

const PROBE = { owner: "thekevinbot", repo: "willrun-probe" };
const V0: WorkflowSource = { ...PROBE, ref: "remote-v0" };
const MAIN: WorkflowSource = { ...PROBE, ref: "main" };
const SHA: WorkflowSource = { ...PROBE, ref: V0_SHA };

const REMOTE_FILES = {
  [at(V0, ".github/workflows/remote-reusable.yml")]: remoteReusable("r-inner"),
  [at(V0, ".github/workflows/remote-inner.yml")]: remoteInner("deep-at-v0"),
  [at(SHA, ".github/workflows/remote-reusable.yml")]: remoteReusable("r-inner"),
  [at(SHA, ".github/workflows/remote-inner.yml")]: remoteInner("deep-at-v0"),
  [at(MAIN, ".github/workflows/remote-reusable.yml")]: remoteReusable("r-inner-at-main"),
  [at(MAIN, ".github/workflows/remote-inner.yml")]: remoteInner("deep-at-main"),
  // The decoy. The probe's PR head really does carry its own copy of
  // `remote-inner.yml`, so resolving the callee's `./` call against the caller
  // instead of the callee would find a file and produce a plausible wrong
  // name, not a miss.
  [local(".github/workflows/remote-inner.yml")]: remoteInner("deep-at-caller-head"),
};

const REMOTE_CALLER = `
name: remote-caller
on: pull_request
jobs:
  call-remote-tag:
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0
  call-remote-named:
    name: Remote Caller
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0
  call-remote-matrix:
    strategy: { matrix: { v: [a, b] } }
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0
  call-remote-branch:
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@main
  call-remote-sha:
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@${V0_SHA}
  call-remote-skipped:
    if: false
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0
`;

/** The exact job names GitHub created for remote-caller.yml on probe PR #9. */
const OBSERVED_REMOTE_CALLER = [
  "Remote Caller / Remote Label",
  "Remote Caller / Remote Local Call / deep-at-v0",
  "Remote Caller / r-inner",
  "Remote Caller / r-matrix (1)",
  "Remote Caller / r-matrix (2)",
  "call-remote-branch / Remote Label",
  "call-remote-branch / Remote Local Call / deep-at-main",
  "call-remote-branch / r-inner-at-main",
  "call-remote-branch / r-matrix (1)",
  "call-remote-branch / r-matrix (2)",
  "call-remote-matrix (a) / Remote Label",
  "call-remote-matrix (a) / Remote Local Call / deep-at-v0",
  "call-remote-matrix (a) / r-inner",
  "call-remote-matrix (a) / r-matrix (1)",
  "call-remote-matrix (a) / r-matrix (2)",
  "call-remote-matrix (b) / Remote Label",
  "call-remote-matrix (b) / Remote Local Call / deep-at-v0",
  "call-remote-matrix (b) / r-inner",
  "call-remote-matrix (b) / r-matrix (1)",
  "call-remote-matrix (b) / r-matrix (2)",
  "call-remote-sha / Remote Label",
  "call-remote-sha / Remote Local Call / deep-at-v0",
  "call-remote-sha / r-inner",
  "call-remote-sha / r-matrix (1)",
  "call-remote-sha / r-matrix (2)",
  "call-remote-skipped",
  "call-remote-tag / Remote Label",
  "call-remote-tag / Remote Local Call / deep-at-v0",
  "call-remote-tag / r-inner",
  "call-remote-tag / r-matrix (1)",
  "call-remote-tag / r-matrix (2)",
].sort();

test("remote-caller.yml resolves to exactly the checks GitHub created", async () => {
  expect(await nameSet(REMOTE_CALLER, REMOTE_FILES)).toEqual(OBSERVED_REMOTE_CALLER);
});

test("a tag, a branch and a SHA each resolve to that ref's copy", async () => {
  // Same callee path three times; the job name is the only thing separating
  // them, and the tag and its SHA agree while `main` does not.
  expect((await nameSet(REMOTE_CALLER, REMOTE_FILES)).filter((n) => n?.includes("r-inner"))).toEqual([
      "Remote Caller / r-inner",
      "call-remote-branch / r-inner-at-main",
      "call-remote-matrix (a) / r-inner",
      "call-remote-matrix (b) / r-inner",
      "call-remote-sha / r-inner",
      "call-remote-tag / r-inner",
    ]);
});

test("a remote callee's relative uses: resolves against the callee, not the caller", async () => {
  // `deep-at-v0`, not `deep-at-caller-head`: the `./` inside a workflow reached
  // by `owner/repo/...@remote-v0` reads the repo and ref that workflow came
  // from. GitHub had the caller's copy available and did not use it.
  expect(await nameSet(
      `
jobs:
  call:
    uses: thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0
`,
      REMOTE_FILES,
    )).toEqual([
      "call / Remote Label",
      "call / Remote Local Call / deep-at-v0",
      "call / r-inner",
      "call / r-matrix (1)",
      "call / r-matrix (2)",
    ]);
});

test("a remote call costs one level of depth, same as a local one", async () => {
  // Four `uses:` deep is the limit. This chain alternates local and remote
  // hops — local, remote, local, remote — so the counter has to have counted
  // both kinds for the fifth hop to be the one declined. The fifth here is
  // `r-call-local`, the callee's own `./` call.
  const chain = (uses: string) => `
on: { workflow_call: {} }
jobs:
  j:
    uses: ${uses}
`;
  const REMOTE =
    "thekevinbot/willrun-probe/.github/workflows/remote-reusable.yml@remote-v0";
  const files = {
    [local(".github/workflows/l1.yml")]: chain(`${PROBE.owner}/${PROBE.repo}/r2.yml@t`),
    [at({ ...PROBE, ref: "t" }, "r2.yml")]: chain("./l3.yml"),
    [at({ ...PROBE, ref: "t" }, "l3.yml")]: chain(REMOTE),
    ...REMOTE_FILES,
  };
  expect((await jobs(`jobs: { j: { uses: ./.github/workflows/l1.yml } }`, files)).map(
      (e) => [e.job, e.status],
    )).toEqual([
      ["j / j / j / j / r-inner", "run"],
      ["j / j / j / j / Remote Label", "run"],
      ["j / j / j / j / r-matrix (1)", "run"],
      ["j / j / j / j / r-matrix (2)", "run"],
      ["j / j / j / j / Remote Local Call", "unknown"],
    ]);
});

test("a remote callee that cannot be fetched is one unknown entry", async () => {
  // Probe-observed shape on `remote-bad.yml`: GitHub fails the whole run at
  // startup and creates no job checks at all. One `unknown` entry is the
  // conservative reading — it is never a name we would compare against.
  expect(await jobs(
      `
jobs:
  call-missing:
    uses: thekevinbot/willrun-probe/.github/workflows/does-not-exist.yml@remote-v0
`,
      REMOTE_FILES,
    )).toEqual([{ job: "call-missing", checkName: null, status: "unknown" }]);
});

test("a remote callee that is not valid YAML is one unknown entry", async () => {
  expect(await jobs(
      `
jobs:
  call:
    uses: other/repo/.github/workflows/x.yml@v1
`,
      { [at({ owner: "other", repo: "repo", ref: "v1" }, ".github/workflows/x.yml")]: "a: [" },
    )).toEqual([{ job: "call", checkName: null, status: "unknown" }]);
});

test("a uses: we cannot split into a repo and a ref is one unknown entry", async () => {
  for (const uses of [
    "not-a-reference",
    "owner/repo@v1",
    "owner/repo/.github/workflows/x.yml@",
    "@v1",
    "./",
    "${{ env.CALLEE }}/.github/workflows/x.yml@v1",
  ]) {
    expect(await jobs(`jobs: { call: { uses: "${uses}" } }`, REMOTE_FILES), uses).toEqual([
      { job: "call", checkName: null, status: "unknown" },
    ]);
  }
});

test("parseUses splits both spellings and rejects the rest", async () => {
  expect(parseUses("./.github/workflows/x.yml")).toEqual({
    path: ".github/workflows/x.yml",
    source: null,
  });
  expect(parseUses("o/r/.github/workflows/x.yml@v1")).toEqual({
    path: ".github/workflows/x.yml",
    source: { owner: "o", repo: "r", ref: "v1" },
  });
  // The ref comes off the last `@`, so a branch with a slash survives.
  expect(parseUses("o/r/w.yml@feature/foo")).toEqual({
    path: "w.yml",
    source: { owner: "o", repo: "r", ref: "feature/foo" },
  });
  for (const bad of ["x", "o/r@v1", "o/r/w.yml@", "@v1", "./", "o//w.yml@v1"]) {
    expect(parseUses(bad), bad).toBeNull();
  }
});
