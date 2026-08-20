// Check-name resolution, pinned to observed GitHub behaviour.
//
// Every expectation in this file was read back from a live dispatch on
// thekevinbot/willrun-probe: PR #8 for `.github/workflows/names.yml` and
// `names-caller.yml`, PR #9 for `remote-caller.yml` (all mirrored under
// `tests/fixtures/willrun-probe/`). The fixtures below are that same YAML; the
// expected names are the `name` field of the jobs the run actually created.
// Nothing here is inferred from the docs alone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  expandWorkflowJobs,
  parseUses,
  type SourceRef,
  type WorkflowSource,
} from "../../src/predict.js";

/**
 * A workflow from the probe tree, read rather than restated.
 *
 * The expectations below are only ground truth while the YAML under test is the
 * YAML that ran, and a second copy is a copy that drifts. Inlining also forces
 * every `${{` to be hand-escaped for the template literal, which is a silent way
 * to change what a fixture asserts while it still parses.
 */
const workflow = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/willrun-probe/.github/workflows/${name}`, import.meta.url)),
    "utf8",
  );

const ctx = { action: "opened", baseRef: "main", files: ["src/app.txt"] };

/** The probe repo at the PR head — the repo and ref expansion starts from. */
const HEAD: WorkflowSource = {
  owner: "thekevinbot",
  repo: "willrun-probe",
  ref: "headsha",
  sha: "headsha",
};

/**
 * A workflow file's full address. Fixtures key on this rather than on a bare
 * path so a lookup that resolves against the wrong repo or the wrong ref
 * misses instead of quietly finding the caller's copy.
 */
const at = (source: SourceRef, path: string) =>
  `${source.owner}/${source.repo}/${path}@${source.ref}`;

/** Address a file in the probe repo at head, the way a local `./` call does. */
const local = (path: string) => at(HEAD, path);

async function jobs(yaml: string, files: Record<string, string> = {}) {
  const wf = parseYaml(yaml);
  const fetchWorkflow = async (p: string, source: WorkflowSource) =>
    files[at(source, p)] ?? null;
  // Every ref in these fixtures is its own commit. This suite is about the
  // names expansion produces, and resolving `remote-v0` to a hex string here
  // would only rename the keys in `files` — the ref-to-commit step has its own
  // tests in the unit suite.
  const resolveRef = async (source: SourceRef) => source.ref;
  const entries = await expandWorkflowJobs(wf, ctx, { fetchWorkflow, resolveRef }, HEAD);
  return entries.map((e) => ({ job: e.job, checkName: e.checkName, status: e.status }));
}

const nameSet = async (yaml: string, files?: Record<string, string>) =>
  (await jobs(yaml, files)).map((e) => e.checkName).sort();

const NAMES_YML = workflow("names.yml");

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

const REUSABLE = workflow("names-reusable.yml");

const MID = workflow("names-mid.yml");

const CALLER = workflow("names-caller.yml");

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
const REMOTE_REUSABLE = workflow("remote-reusable.yml");
const REMOTE_INNER = workflow("remote-inner.yml");

/**
 * The `remote-v0` variant of a checked-in file. `setup-probe.sh` builds that
 * tag by renaming exactly these two jobs in the `main` copies, so mirroring the
 * rename keeps both refs sourced from one file instead of two.
 */
const atV0 = (yaml: string) =>
  yaml
    .replace(/^  r-inner-at-main:$/m, "  r-inner:")
    .replace(/^  deep-at-main:$/m, "  deep-at-v0:");

/**
 * The decoy, and the one variant with no file behind it. The probe repo's PR
 * head carries its own `remote-inner.yml`; this stands in for it under a third
 * job name so resolving the callee's `./` call against the caller finds a file
 * and produces a plausible wrong name rather than a miss.
 */
const REMOTE_INNER_AT_CALLER_HEAD = REMOTE_INNER.replace(
  /^  deep-at-main:$/m,
  "  deep-at-caller-head:",
);

const REMOTE_CALLER = workflow("remote-caller.yml");

/**
 * The SHA `remote-v0` points at. Read out of the caller that pins it rather
 * than restated: `setup-probe.sh` rewrites that line to whatever the tag
 * resolves to at push time, so a literal here would go stale on the next seed.
 */
const V0_SHA = (() => {
  const m = REMOTE_CALLER.match(/remote-reusable\.yml@([0-9a-f]{40})$/m);
  if (m == null) throw new Error("remote-caller.yml no longer pins a SHA");
  return m[1];
})();

const PROBE = { owner: "thekevinbot", repo: "willrun-probe" };
const V0: WorkflowSource = { ...PROBE, ref: "remote-v0" };
const MAIN: WorkflowSource = { ...PROBE, ref: "main" };
const SHA: WorkflowSource = { ...PROBE, ref: V0_SHA };

const REMOTE_FILES = {
  [at(V0, ".github/workflows/remote-reusable.yml")]: atV0(REMOTE_REUSABLE),
  [at(V0, ".github/workflows/remote-inner.yml")]: atV0(REMOTE_INNER),
  [at(SHA, ".github/workflows/remote-reusable.yml")]: atV0(REMOTE_REUSABLE),
  [at(SHA, ".github/workflows/remote-inner.yml")]: atV0(REMOTE_INNER),
  [at(MAIN, ".github/workflows/remote-reusable.yml")]: REMOTE_REUSABLE,
  [at(MAIN, ".github/workflows/remote-inner.yml")]: REMOTE_INNER,
  [local(".github/workflows/remote-inner.yml")]: REMOTE_INNER_AT_CALLER_HEAD,
};

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
