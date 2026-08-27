import { describe, expect, it } from "vitest";
import { expandJobs } from "./expandJobs.js";
import type { Scope } from "../expr/val.js";
import type {
  Ctx,
  FetchWorkflow,
  ResolveRef,
  Workflow,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

const SHA = "a".repeat(40);

const REMOTE_SHA = "b".repeat(40);

const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const CTX: Ctx = { action: "opened", baseRef: "main", files: ["src/app.ts"] };

const readerOf = (
  fetchWorkflow: FetchWorkflow,
  resolveRef: ResolveRef = async (src) => src.ref,
): WorkflowReader => ({ fetchWorkflow, resolveRef });

const readerFor = (files: Record<string, string>) =>
  readerOf(async (path) => files[path] ?? null);

const expand = (jobs: Record<string, unknown>, reader: WorkflowReader = readerFor({})) =>
  expandJobs({ on: { pull_request: null }, jobs } as Workflow, CTX, reader, SOURCE);

describe("job expansion", () => {
  it("decides job guards against the scope the caller handed in", async () => {
    const scope: Scope = { inputs: { x: { kind: "value", v: "v" } } };
    const entries = await expandJobs(
      { on: { pull_request: null }, jobs: { a: { if: "inputs.x == 'v'" } } } as Workflow,
      CTX,
      readerFor({}),
      SOURCE,
      0,
      "",
      true,
      scope,
    );
    expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: `if: "inputs.x == 'v'"` }]);
  });

  it("tolerates a job whose body is empty", async () => {
    const entries = await expand({ a: null });
    expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: "" }]);
  });

  it("uses an explicit job name over the job id", async () => {
    const entries = await expand({ a: { name: "Build" } });
    expect(entries[0]).toMatchObject({ job: "Build" });
  });

  it("falls back to the job id when `name` is present but null", async () => {
    const entries = await expand({ a: { name: null } });
    expect(entries[0]).toMatchObject({ job: "a" });
  });

  it("records a job-level `if` as the entry reason", async () => {
    const entries = await expand({ a: { if: false } });
    expect(entries[0]).toMatchObject({ job: "a", status: "skipped", reason: "if: false" });
  });

  describe("needs", () => {
    it("skips a job that needs a skipped job", async () => {
      const entries = await expand({ a: { if: false }, b: { needs: ["a"] } });
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "skipped"],
        ["b", "skipped"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' which is skipped");
    });

    it("accepts a scalar `needs`", async () => {
      const entries = await expand({ a: { if: false }, b: { needs: "a" } });
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped" });
    });

    it("propagates an unknown upstream status", async () => {
      const entries = await expand({
        a: { if: "needs.x.outputs.y == 'z'" },
        b: { needs: ["a"] },
      });
      expect(entries.map((e) => [e.job, e.status])).toEqual([
        ["a", "unknown"],
        ["b", "unknown"],
      ]);
      expect(entries[1].reason).toBe("needs 'a' whose status is unknown");
    });

    it("leaves an already-unknown job unknown rather than restating why", async () => {
      const entries = await expand({
        a: { if: "github.ref == 'x'" },
        b: { if: "github.ref == 'y'", needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({
        job: "b",
        status: "unknown",
        reason: "if: \"github.ref == 'y'\"",
      });
    });

    it("does not propagate upstream status through always()", async () => {
      const entries = await expand({
        a: { if: false },
        b: { if: "always()", needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({ job: "b", status: "run" });
    });

    it("leaves an already-skipped job alone rather than re-deriving it", async () => {
      const entries = await expand({
        a: { if: false },
        b: { if: false, needs: ["a"] },
      });
      expect(entries[1]).toMatchObject({ job: "b", status: "skipped", reason: "if: false" });
    });
  });

  describe("matrix", () => {
    it("names one entry per combination", async () => {
      const entries = await expand({ a: { strategy: { matrix: { os: ["linux", "mac"] } } } });
      expect(entries.map((e) => e.job)).toEqual(["a (linux)", "a (mac)"]);
    });

    it("substitutes matrix values into an explicit job name", async () => {
      const entries = await expand({
        a: { name: "build ${{ matrix.os }}", strategy: { matrix: { os: ["linux", "mac"] } } },
      });
      expect(entries.map((e) => e.job)).toEqual(["build linux", "build mac"]);
    });

    it("leaves an unset matrix key in place rather than guessing at it", async () => {
      const entries = await expand({
        a: { name: "build ${{ matrix.nope }}", strategy: { matrix: { os: ["linux"] } } },
      });
      expect(entries[0]).toMatchObject({
        job: "build ${{ matrix.nope }}",
        checkName: null,
      });
    });

    it("evaluates github.event_name, the one expression this can decide", async () => {
      const entries = await expand({ a: { name: "on ${{ github.event_name }}" } });
      expect(entries[0]).toMatchObject({
        job: "on pull_request",
        checkName: "on pull_request",
      });
    });

    it("renders a null matrix value as nothing and a list value as a joined run", async () => {
      const entries = await expand({ a: { strategy: { matrix: { v: [null, [1, 2]] } } } });
      expect(entries.map((e) => e.job)).toEqual(["a ()", "a (1, 2)"]);
    });

    it("omits the parenthetical when a combination has no keys to show", async () => {
      const entries = await expand({ a: { strategy: { matrix: { include: [{}] } } } });
      expect(entries).toEqual([{ job: "a", checkName: "a", status: "run", reason: "" }]);
    });

    it("cannot resolve a matrix expression on a job that has no matrix", async () => {
      const entries = await expand({ a: { name: "build ${{ matrix.os }}" } });
      expect(entries[0]).toMatchObject({
        job: "build ${{ matrix.os }}",
        checkName: null,
        status: "run",
      });
    });

    it("reports a dynamic matrix as unknown", async () => {
      const entries = await expand({
        a: { strategy: { matrix: "${{ fromJSON(needs.x.outputs.m) }}" } },
      });
      expect(entries[0]).toMatchObject({
        job: "a",
        status: "unknown",
        reason: "dynamic matrix",
      });
    });
  });
});

describe("reusable workflows", () => {
  const SUB = ".github/workflows/sub.yml";
  const SUB2 = ".github/workflows/sub2.yml";

  it("inlines the called workflow's jobs under a prefixed name", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: { name: "Inner" } } }),
      }),
    );
    expect(entries.map((e) => [e.job, e.status])).toEqual([["call / Inner", "run"]]);
  });

  it("prefixes with the caller job's own name when it has one", async () => {
    const entries = await expand(
      { call: { name: "Called", uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } }),
      }),
    );
    expect(entries.map((e) => e.job)).toEqual(["Called / inner"]);
  });

  it("follows a nested call and keeps prefixing", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({
          on: { workflow_call: null },
          jobs: { mid: { uses: "./.github/workflows/sub2.yml" } },
        }),
        [SUB2]: JSON.stringify({ on: { workflow_call: null }, jobs: { deep: {} } }),
      }),
    );
    expect(entries).toEqual([
      { job: "call / mid / deep", checkName: "call / mid / deep", status: "run", reason: "" },
    ]);
  });

  it("gives up past the four-level call chain GitHub allows", async () => {
    const link = (next: string) =>
      JSON.stringify({
        on: { workflow_call: null },
        jobs: { j: { uses: `./.github/workflows/${next}` } },
      });
    const entries = await expand(
      { call: { uses: "./.github/workflows/n1.yml" } },
      readerFor({
        ".github/workflows/n1.yml": link("n2.yml"),
        ".github/workflows/n2.yml": link("n3.yml"),
        ".github/workflows/n3.yml": link("n4.yml"),
        ".github/workflows/n4.yml": link("n5.yml"),
        ".github/workflows/n5.yml": JSON.stringify({
          on: { workflow_call: null },
          jobs: { leaf: {} },
        }),
      }),
    );
    expect(entries).toEqual([
      {
        job: "call / j / j / j / j",
        checkName: null,
        status: "unknown",
        reason: "reusable workflow nested deeper than 4 levels",
      },
    ]);
  });

  it("reports a dynamic matrix on the calling job as unknown", async () => {
    const fetched: string[] = [];
    const entries = await expand(
      {
        call: {
          uses: "./.github/workflows/sub.yml",
          strategy: { matrix: "${{ fromJSON(needs.x.outputs.m) }}" },
        },
      },
      readerOf(async (path) => {
        fetched.push(path);
        return JSON.stringify({ on: { workflow_call: null } });
      }),
    );
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "dynamic matrix on reusable workflow call",
      },
    ]);
    expect(fetched).toEqual([]);
  });

  it("reports a callee that does not parse as unknown", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({ [SUB]: "jobs:\n  a: [unclosed\n" }),
    );
    expect(entries[0]).toMatchObject({ job: "call", checkName: null, status: "unknown" });
    expect(entries[0].reason).toMatch(
      /^YAML parse error in \.\/\.github\/workflows\/sub\.yml: /,
    );
  });

  it("reports a callee that parses to nothing as unresolvable", async () => {
    const entries = await expand(
      { call: { uses: "./.github/workflows/sub.yml" } },
      readerFor({ [SUB]: "" }),
    );
    expect(entries).toEqual([
      {
        job: "call",
        checkName: null,
        status: "unknown",
        reason: "cannot resolve ./.github/workflows/sub.yml",
      },
    ]);
  });

  it("nulls the name of a skipped job inside an unresolvable caller", async () => {
    const entries = await expand(
      { call: { name: "${{ inputs.flavour }}", uses: "./.github/workflows/sub.yml" } },
      readerFor({
        [SUB]: JSON.stringify({ on: { workflow_call: null }, jobs: { inner: { if: false } } }),
      }),
    );
    expect(entries[0]).toMatchObject({
      job: "${{ inputs.flavour }} / inner",
      checkName: null,
      status: "skipped",
    });
  });

  it("reports a cross-repo reusable whose ref will not resolve", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => null,
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: `cannot resolve ref for ${uses}`,
    });
  });

  it("reports a cross-repo reusable it resolved but cannot fetch", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => REMOTE_SHA,
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: `cannot fetch ${uses}`,
    });
  });

  it("skips resolution for a `uses:` already pinned to a commit", async () => {
    const uses = `octo/repo/.github/workflows/x.yml@${REMOTE_SHA}`;
    const entries = await expand(
      { call: { uses } },
      readerOf(
        async () => null,
        async () => {
          throw new Error("resolution must not run for a pinned sha");
        },
      ),
    );
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: `cannot fetch ${uses}`,
    });
  });

  it("reports a local reusable that is missing at head", async () => {
    const entries = await expand({ call: { uses: "./.github/workflows/sub.yml" } });
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: "cannot fetch ./.github/workflows/sub.yml",
    });
  });

  it("skips a caller job whose `if` is false without expanding it", async () => {
    const fetched: string[] = [];
    const entries = await expand(
      { call: { if: false, uses: "./.github/workflows/sub.yml" } },
      readerOf(async (path) => {
        fetched.push(path);
        return JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } });
      }),
    );
    expect(entries).toEqual([
      { job: "call", checkName: "call", status: "skipped", reason: "if: false" },
    ]);
    expect(fetched).toEqual([]);
  });

  it("reports a uses: it cannot turn into a fetch target", async () => {
    const entries = await expand({ call: { uses: "not-a-reference" } });
    expect(entries[0]).toMatchObject({
      job: "call",
      status: "unknown",
      reason: "unresolvable reusable reference: not-a-reference",
    });
  });
});
