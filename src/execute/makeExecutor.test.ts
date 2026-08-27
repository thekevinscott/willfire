import { afterEach, describe, expect, it, vi } from "vitest";
import { makeExecutor } from "./makeExecutor.js";
import { makeTreeProvider } from "./makeTreeProvider.js";
import { runShell } from "./runShell.js";
import type { ExecDeps, ExecOutcome } from "./types.js";
import type { WorkflowSource } from "../types.js";

vi.mock("./makeTreeProvider.js", async () => {
  const actual = await vi.importActual<typeof import("./makeTreeProvider.js")>("./makeTreeProvider.js");
  return { ...actual };
});

vi.mock("./runShell.js", async () => {
  const actual = await vi.importActual<typeof import("./runShell.js")>("./runShell.js");
  return { ...actual };
});

const SHA = "c".repeat(40);
const REMOTE_SHA = "d".repeat(40);

const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };
let treeSeq = 0;

async function tempTree(files: Record<string, string>): Promise<string> {
  const root = `${TMP}/wf-exec-test-${process.pid}-${treeSeq++}`;
  const r0 = await runShell({
    script: 'mkdir -p "$D"',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, D: root },
  });
  expect(r0.code).toBe(0);
  for (const [rel, content] of Object.entries(files)) {
    const r = await runShell({
      script: 'mkdir -p "$(dirname "$F")" && printf %s "$C" > "$F"',
      shell: "bash",
      cwd: TMP,
      env: { ...SH_ENV, F: `${root}/${rel}`, C: content },
    });
    expect(r.code).toBe(0);
  }
  return root;
}

function depsOf(trees: Record<string, string>, overrides: Partial<ExecDeps> = {}): ExecDeps {
  return {
    provideTree: async (src) => trees[`${src.owner}/${src.repo}@${src.sha}`] ?? null,
    runCommand: runShell,
    resolveRef: async (src) => src.ref,
    ...overrides,
  };
}

function executorOf(trees: Record<string, string>, overrides: Partial<ExecDeps> = {}) {
  return makeExecutor({
    grants: [{ repo: "o/r", jobs: ["detect"] }],
    workspace: WORKSPACE,
    deps: depsOf(trees, overrides),
  });
}

async function execute(
  job: Record<string, unknown>,
  files: Record<string, string> = {},
  overrides: Partial<ExecDeps> = {},
  wf: Record<string, unknown> = {},
  scope = {},
): Promise<ExecOutcome> {
  const tree = await tempTree(files);
  const ex = executorOf({ [`o/r@${SHA}`]: tree }, overrides);
  return ex.executeJob("detect", job, wf, scope);
}

const failure = (o: ExecOutcome): string => {
  if (o.ok) {
    throw new Error("expected a failure");
  }
  return o.reason;
};

const success = (o: ExecOutcome): Record<string, string> => {
  if (!o.ok) {
    throw new Error(`expected success, got: ${o.reason}`);
  }
  return o.outputs;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("granted", () => {
  const ex = executorOf({});

  it("matches on the repo the workflow file lives in, and the job id", () => {
    expect(ex.granted(WORKSPACE, "detect")).toBe(true);
    expect(ex.granted(WORKSPACE, "build")).toBe(false);
    expect(ex.granted({ owner: "other", repo: "r", ref: SHA, sha: SHA }, "detect")).toBe(false);
  });
});

describe("executing run steps", () => {
  it("runs the steps and assembles the job outputs from what they wrote", async () => {
    const out = success(
      await execute({
        steps: [
          { id: "scan", run: 'echo "languages=[\\"ts\\"]" >> "$GITHUB_OUTPUT"' },
        ],
        outputs: { languages: "${{ steps.scan.outputs.languages }}" },
      }),
    );
    expect(out).toEqual({ languages: '["ts"]' });
  });

  it("satisfies a bare actions/checkout instead of running it", async () => {
    const out = success(
      await execute(
        {
          steps: [
            { uses: "actions/checkout@v6" },
            { id: "s", run: 'echo "f=$(cat file.txt)" >> "$GITHUB_OUTPUT"' },
          ],
          outputs: { f: "${{ steps.s.outputs.f }}" },
        },
        { "file.txt": "tree-content" },
      ),
    );
    expect(out).toEqual({ f: "tree-content" });
  });

  it("stops on a checkout with inputs — that is a different tree", async () => {
    const o = await execute({ steps: [{ uses: "actions/checkout@v6", with: { ref: "main" } }] });
    expect(failure(o)).toMatch(/actions\/checkout with inputs is not modelled/);
  });

  it("skips a step whose if is false and coalesces past its empty outputs", async () => {
    const out = success(
      await execute({
        steps: [
          {
            id: "scan_hermetic",
            if: "github.repository == 'thekevinscott/testing-conventions'",
            run: "exit 1",
          },
          {
            id: "scan_published",
            if: "github.repository != 'thekevinscott/testing-conventions'",
            run: 'echo "x=[\\"typescript\\"]" >> "$GITHUB_OUTPUT"',
          },
        ],
        outputs: {
          x: "${{ steps.scan_hermetic.outputs.x || steps.scan_published.outputs.x }}",
        },
      }),
    );
    expect(out).toEqual({ x: '["typescript"]' });
  });

  it("skips an id-less step without recording anything", async () => {
    const out = success(
      await execute({
        steps: [
          { if: "false", run: "exit 1" },
          { id: "s", run: 'echo "x=ran" >> "$GITHUB_OUTPUT"' },
        ],
        outputs: { x: "${{ steps.s.outputs.x }}" },
      }),
    );
    expect(out).toEqual({ x: "ran" });
  });

  it("stops on an if it cannot decide", async () => {
    const o = await execute({ steps: [{ id: "s", if: "env.FOO", run: "true" }] });
    expect(failure(o)).toBe("cannot decide if: for step 's'");
  });

  it("stops when a step exits non-zero, keeping the last stderr line", async () => {
    const o = await execute({ steps: [{ run: "echo boom >&2; exit 3" }] });
    expect(failure(o)).toBe("step '#1': exited 3 (boom)");
  });

  it("layers workflow, job and step env, rendering each", async () => {
    const out = success(
      await execute(
        {
          env: { B: "j" },
          steps: [
            {
              id: "s",
              env: { C: "${{ inputs.x }}" },
              run: 'echo "v=$A$B$C" >> "$GITHUB_OUTPUT"',
            },
          ],
          outputs: { v: "${{ steps.s.outputs.v }}" },
        },
        {},
        {},
        { env: { A: "w" } },
        { inputs: { x: { kind: "value", v: "i" } } },
      ),
    );
    expect(out).toEqual({ v: "wji" });
  });

  it("renders a null env value as the empty string", async () => {
    const out = success(
      await execute({
        steps: [{ id: "s", run: 'echo "x=<$K>" >> "$GITHUB_OUTPUT"', env: { K: null } }],
        outputs: { x: "${{ steps.s.outputs.x }}" },
      }),
    );
    expect(out).toEqual({ x: "<>" });
  });

  it("stops on an env value it cannot render", async () => {
    const o = await execute({ steps: [{ env: { B: "${{ env.nope }}" }, run: "true" }] });
    expect(failure(o)).toBe("step '#1': cannot resolve env 'B'");
  });

  it("stops on an env block that is not a map", async () => {
    const o = await execute({ env: [], steps: [{ run: "true" }] });
    expect(failure(o)).toBe("step '#1': env block is not a map");
  });

  it("stops on a run whose ${{ }} it cannot render", async () => {
    const o = await execute({ steps: [{ name: "n", run: "echo ${{ env.nope }}" }] });
    expect(failure(o)).toBe("step 'n': cannot resolve ${{ }} in run");
  });

  it("stops on a shell it does not model", async () => {
    const o = await execute({ steps: [{ shell: "python", run: "pass" }] });
    expect(failure(o)).toMatch(/shell 'python' is not modelled/);
  });

  it("runs sh steps under sh -e", async () => {
    const out = success(
      await execute({
        steps: [{ id: "s", shell: "sh", run: 'echo "v=1" >> "$GITHUB_OUTPUT"' }],
        outputs: { v: "${{ steps.s.outputs.v }}" },
      }),
    );
    expect(out).toEqual({ v: "1" });
  });

  it("honours working-directory relative to the workspace", async () => {
    const out = success(
      await execute(
        {
          steps: [
            {
              id: "s",
              "working-directory": "sub",
              run: 'echo "d=$(basename "$PWD")" >> "$GITHUB_OUTPUT"',
            },
          ],
          outputs: { d: "${{ steps.s.outputs.d }}" },
        },
        { "sub/.keep": "" },
      ),
    );
    expect(out).toEqual({ d: "sub" });
  });

  it("stops on a working-directory it cannot render", async () => {
    const o = await execute({
      steps: [{ "working-directory": "${{ env.nope }}", run: "true" }],
    });
    expect(failure(o)).toBe("step '#1': cannot resolve working-directory");
  });

  it("stops on malformed GITHUB_OUTPUT", async () => {
    const o = await execute({ steps: [{ id: "s", run: 'echo garbage >> "$GITHUB_OUTPUT"' }] });
    expect(failure(o)).toBe("step 's': malformed GITHUB_OUTPUT");
  });

  it("stops on a step that has neither uses nor run", async () => {
    const o = await execute({ steps: [null] });
    expect(failure(o)).toBe("step '#1' has neither uses nor run");
  });

  it("yields an empty map for a job that declares no outputs", async () => {
    expect(success(await execute({ steps: [{ run: "true" }] }))).toEqual({});
  });

  it("stops on a job output it cannot resolve", async () => {
    const o = await execute({
      steps: [{ run: "true" }],
      outputs: { x: "${{ steps.nope.outputs.x }}" },
    });
    expect(failure(o)).toBe("cannot resolve job output 'x'");
  });

  it("refuses the job shapes it does not model, by name", async () => {
    expect(failure(await execute({ strategy: {}, steps: [] }))).toMatch(/has a strategy/);
    expect(failure(await execute({ container: "img", steps: [] }))).toMatch(/container or services/);
    expect(failure(await execute({ services: {}, steps: [] }))).toMatch(/container or services/);
    expect(failure(await execute({}))).toMatch(/has no steps/);
  });

  it("fails when the workspace cannot be materialized", async () => {
    const ex = executorOf({});
    const o = await ex.executeJob("detect", { steps: [] }, {}, {});
    expect(failure(o)).toBe(`cannot materialize workspace o/r@${SHA}`);
  });

  it("falls back to empty PATH and HOME when the parent has neither", async () => {
    vi.stubEnv("PATH", undefined as never);
    vi.stubEnv("HOME", undefined as never);
    const o = await execute({ steps: [{ run: "true" }] });
    expect(failure(o)).toMatch(/exited 127/);
  });
});

const compositeAction = (
  steps: unknown[],
  extra: Record<string, unknown> = {},
): string => JSON.stringify({ runs: { using: "composite", steps }, ...extra });

describe("composite actions", () => {
  it("runs a local composite, binding with: over declared defaults", async () => {
    const manifest = compositeAction(
      [
        {
          id: "s",
          shell: "bash",
          run:
            'echo "got=${{ inputs.who }}" >> "$GITHUB_OUTPUT"; ' +
            'echo "ap=$GITHUB_ACTION_PATH" >> "$GITHUB_OUTPUT"',
        },
      ],
      {
        inputs: { who: { default: "default-who" }, other: {} },
        outputs: {
          got: { value: "${{ steps.s.outputs.got }}" },
          ap: { value: "${{ steps.s.outputs.ap }}" },
        },
      },
    );
    const tree = await tempTree({ "action/action.yml": manifest });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [{ id: "a", uses: "./action", with: { who: "caller-who" } }],
          outputs: { got: "${{ steps.a.outputs.got }}", ap: "${{ steps.a.outputs.ap }}" },
        },
        {},
        {},
      ),
    );
    expect(out.got).toBe("caller-who");
    expect(out.ap).toBe(`${tree}/action`);
  });

  it("falls back to a declared default when with: omits the input", async () => {
    const manifest = compositeAction(
      [{ id: "s", shell: "bash", run: 'echo "got=${{ inputs.who }}-${{ inputs.other }}" >> "$GITHUB_OUTPUT"' }],
      {
        inputs: { who: { default: "default-who" }, other: {} },
        outputs: { got: { value: "${{ steps.s.outputs.got }}" } },
      },
    );
    const tree = await tempTree({ "action/action.yml": manifest });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(
      await ex.executeJob(
        "detect",
        { steps: [{ id: "a", uses: "./action" }], outputs: { got: "${{ steps.a.outputs.got }}" } },
        {},
        {},
      ),
    );
    expect(out.got).toBe("default-who-");
  });

  it("stringifies boolean and number with: values, as action inputs are", async () => {
    const manifest = compositeAction(
      [{ id: "s", shell: "bash", run: 'echo "got=${{ inputs.flag }}/${{ inputs.n }}" >> "$GITHUB_OUTPUT"' }],
      { outputs: { got: { value: "${{ steps.s.outputs.got }}" } } },
    );
    const tree = await tempTree({ "action/action.yml": manifest });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [{ id: "a", uses: "./action", with: { flag: true, n: 3 } }],
          outputs: { got: "${{ steps.a.outputs.got }}" },
        },
        {},
        {},
      ),
    );
    expect(out.got).toBe("true/3");
  });

  it("binds a null with: value as the empty string", async () => {
    const manifest = compositeAction(
      [{ id: "s", shell: "bash", run: 'echo "got=<${{ inputs.x }}>" >> "$GITHUB_OUTPUT"' }],
      { outputs: { got: { value: "${{ steps.s.outputs.got }}" } } },
    );
    const tree = await tempTree({ "action/action.yml": manifest });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [{ id: "a", uses: "./action", with: { x: null } }],
          outputs: { got: "${{ steps.a.outputs.got }}" },
        },
        {},
        {},
      ),
    );
    expect(out.got).toBe("<>");
  });

  it("leaves an unrenderable with: value unknown until a step reads it", async () => {
    const manifest = compositeAction(
      [{ shell: "bash", run: 'echo ${{ inputs.who }}' }],
      { outputs: {} },
    );
    const tree = await tempTree({ "action/action.yml": manifest });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const o = await ex.executeJob(
      "detect",
      { steps: [{ uses: "./action", with: { who: "${{ env.nope }}" } }] },
      {},
      {},
    );
    expect(failure(o)).toBe("step '#1' (./action): step '#1': cannot resolve ${{ }} in run");
  });

  it("runs a remote composite pinned to a sha, at a subdirectory", async () => {
    const manifest = compositeAction(
      [{ id: "s", shell: "bash", run: 'echo "v=remote" >> "$GITHUB_OUTPUT"' }],
      { outputs: { v: { value: "${{ steps.s.outputs.v }}" } } },
    );
    const workspace = await tempTree({});
    const actTree = await tempTree({ "dir/action.yml": manifest });
    const ex = executorOf({
      [`o/r@${SHA}`]: workspace,
      [`e/act@${REMOTE_SHA}`]: actTree,
    });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [{ id: "a", uses: `e/act/dir@${REMOTE_SHA}` }],
          outputs: { v: "${{ steps.a.outputs.v }}" },
        },
        {},
        {},
      ),
    );
    expect(out).toEqual({ v: "remote" });
  });

  it("resolves a tag ref and finds a root-level action.yaml", async () => {
    const manifest = compositeAction(
      [{ id: "s", shell: "bash", run: 'echo "v=tagged" >> "$GITHUB_OUTPUT"' }],
      { outputs: { v: { value: "${{ steps.s.outputs.v }}" } } },
    );
    const workspace = await tempTree({});
    const actTree = await tempTree({ "action.yaml": manifest });
    const ex = executorOf({
      [`o/r@${SHA}`]: workspace,
      "e/act@v1": actTree,
    });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [{ id: "a", uses: "e/act@v1" }],
          outputs: { v: "${{ steps.a.outputs.v }}" },
        },
        {},
        {},
      ),
    );
    expect(out).toEqual({ v: "tagged" });
  });

  it("runs a composite that declares no steps, evaluating its outputs", async () => {
    const tree = await tempTree({
      "action/action.yml": JSON.stringify({
        runs: { using: "composite" },
        outputs: { x: { value: "fixed" } },
      }),
    });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(
      await ex.executeJob(
        "detect",
        { steps: [{ id: "a", uses: "./action" }], outputs: { x: "${{ steps.a.outputs.x }}" } },
        {},
        {},
      ),
    );
    expect(out).toEqual({ x: "fixed" });
  });

  it("runs a composite that declares no outputs", async () => {
    const tree = await tempTree({
      "action/action.yml": compositeAction([{ shell: "bash", run: "true" }]),
    });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const out = success(await ex.executeJob("detect", { steps: [{ uses: "./action" }] }, {}, {}));
    expect(out).toEqual({});
  });

  it("stops when the ref cannot be resolved", async () => {
    const workspace = await tempTree({});
    const ex = executorOf({ [`o/r@${SHA}`]: workspace }, { resolveRef: async () => null });
    const o = await ex.executeJob("detect", { steps: [{ uses: "e/act@v1" }] }, {}, {});
    expect(failure(o)).toBe("step '#1': cannot resolve ref for e/act@v1");
  });

  it("stops when the action tree cannot be materialized", async () => {
    const workspace = await tempTree({});
    const ex = executorOf({ [`o/r@${SHA}`]: workspace });
    const o = await ex.executeJob(
      "detect",
      { steps: [{ uses: `e/act@${REMOTE_SHA}` }] },
      {},
      {},
    );
    expect(failure(o)).toBe(`step '#1': cannot materialize e/act@${REMOTE_SHA}`);
  });

  it("stops on a uses it cannot parse", async () => {
    const workspace = await tempTree({});
    const ex = executorOf({ [`o/r@${SHA}`]: workspace });
    for (const uses of ["actions/setup-node", "docker://alpine:3", "@v1", "single@v1", "o/a@"]) {
      const o = await ex.executeJob("detect", { steps: [{ uses }] }, {}, {});
      expect(failure(o)).toBe(`step '#1': unresolvable uses: ${uses}`);
    }
  });

  it("stops when there is no action.yml where uses points", async () => {
    const workspace = await tempTree({});
    const ex = executorOf({ [`o/r@${SHA}`]: workspace });
    const o = await ex.executeJob("detect", { steps: [{ uses: "./missing" }] }, {}, {});
    expect(failure(o)).toBe("step '#1': no action.yml under ./missing");
  });

  it("stops on an action.yml that does not parse", async () => {
    const tree = await tempTree({ "action/action.yml": "{" });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const o = await ex.executeJob("detect", { steps: [{ uses: "./action" }] }, {}, {});
    expect(failure(o)).toMatch(/^step '#1': YAML parse error in \.\/action:/);
  });

  it("refuses to execute a JavaScript action", async () => {
    const tree = await tempTree({
      "action/action.yml": JSON.stringify({ runs: { using: "node20", main: "index.js" } }),
    });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const o = await ex.executeJob("detect", { steps: [{ uses: "./action" }] }, {}, {});
    expect(failure(o)).toBe(
      "step '#1': action ./action runs via 'node20'; only composite actions are executed",
    );
  });

  it("stops on an action output it cannot resolve, or one with no value", async () => {
    const tree = await tempTree({
      "a1/action.yml": compositeAction([], {
        outputs: { x: { value: "${{ steps.nope.outputs.x }}" } },
      }),
      "a2/action.yml": compositeAction([], { outputs: { x: {} } }),
      "a3/action.yml": compositeAction([], { outputs: { x: null } }),
    });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const o1 = await ex.executeJob("detect", { steps: [{ uses: "./a1" }] }, {}, {});
    expect(failure(o1)).toBe("step '#1': cannot resolve output 'x' of ./a1");
    const o2 = await ex.executeJob("detect", { steps: [{ uses: "./a2" }] }, {}, {});
    expect(failure(o2)).toBe("step '#1': output 'x' of ./a2 has no value");
    const o3 = await ex.executeJob("detect", { steps: [{ uses: "./a3" }] }, {}, {});
    expect(failure(o3)).toBe("step '#1': output 'x' of ./a3 has no value");
  });

  it("stops a self-including action at the nesting cap", async () => {
    const tree = await tempTree({
      "action/action.yml": compositeAction([{ uses: "./action" }]),
    });
    const ex = executorOf({ [`o/r@${SHA}`]: tree });
    const o = await ex.executeJob("detect", { steps: [{ uses: "./action" }] }, {}, {});
    expect(failure(o)).toMatch(/actions nested deeper than 4 levels/);
  });
});

const tarball = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, "base64"));

describe("the whole path, tarball to job outputs", () => {
  const WORKSPACE_TB = "H4sIAAAAAAAAA+3S3QrCIBiAYS/FG5hz5s/1yIigIMOto+jeWzuKUYtoFtH7nCgo+MGrqkVxehCCG9fBdL2zD95ZIV350YQ4dn3MUoqcUj9379n5j1J1qnLVDsp9hJf7N42xhv6fcNP/ENtd3KzVtkv7Rd+4RvXezvQ3k/4rZ7SQetEpHvjz/qfztycAAAAAAAAAAAAAAADAOy7gGhoPACgAAA==";
  const CALLEE_TB = "H4sIAAAAAAAAA+2UXWvbMBSGfZ1fcaYVerPYzocd2FghK6MtHU1YHXaRhKI6SqzVlY0lFYrxf5/ldhnLkowwJ2XbeW5k6RzrlfTqyHasveOW9Hpe1Zastmu+e77XtcDb/9IsS0tFMwArSxK1Le938b8U21F3TRU2ZyX7ugo7+99qeb0O+n8IfvKfhoonQtZ9D3b3v9PuoP8HYa3/M6ZYqGq7Brv73/Vc9P8gbPP/qWs/3sd/pmFM9f3uRv+7fnvFf99zPQvcera4nf/c/5xkWkjyFnKiJReL8ouEyX2aSK4YeQNEKpaa+DgnfGaiMqSiCkQsjs3ALZWRGWDioZrnU//q7NoEjvIcuEi1knZMxULTBZNQFKQok0tVkzIhR2cXwfnow03/NLgYXN0M+8G5Y9uOUbFlNCFwcgI/sgajYDgKJoQUUzPL0+yV6lKh6s3YnOpYGQlSmMxEqw2pDzTW7Ptyq93alfjzHytLL4qXdqxe1tb/8+HXpVG9/97m97/ter+8/60W1v8heP3K0TJzbrlwyvoFU8sNPocxNOewrLovg8+X18P+6UcnpeFdWQv2V5kIAtN3oCImGgAsjBI4XpbK+zFRjymTYcZTRabHDRZLti6tDM1546UPAUEQBEEQBEEQBEEQBEEQBEEQ5B/iG0SKYN8AKAAA";

  it("executes a detect-shaped job from a real tarball through real steps", async () => {
    const download = async (src: WorkflowSource) =>
      tarball(src.repo === "r" ? WORKSPACE_TB : CALLEE_TB);
    const provide = makeTreeProvider(download, runShell);
    const ex = makeExecutor({
      grants: [{ repo: "tk/tc", jobs: ["detect"] }],
      workspace: WORKSPACE,
      deps: { provideTree: provide, runCommand: runShell, resolveRef: async (s) => s.ref },
    });
    const out = success(
      await ex.executeJob(
        "detect",
        {
          steps: [
            { uses: "actions/checkout@v6" },
            {
              id: "scan_hermetic",
              if: "github.repository == 'tk/tc'",
              run: "exit 1",
            },
            {
              id: "scan_published",
              if: "github.repository != 'tk/tc'",
              uses: `tk/tc/actions/detect@${REMOTE_SHA}`,
            },
          ],
          outputs: {
            languages:
              "${{ steps.scan_hermetic.outputs.languages || steps.scan_published.outputs.languages }}",
          },
        },
        {},
        {},
      ),
    );
    expect(out).toEqual({ languages: '["typescript"]' });
  });
});
