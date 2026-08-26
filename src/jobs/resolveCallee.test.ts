import { describe, expect, it } from "vitest";
import { resolveCallee } from "./resolveCallee.js";
import type {
  FetchWorkflow,
  ResolveRef,
  WorkflowReader,
  WorkflowSource,
} from "../types.js";

const SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const LOCAL = "./.github/workflows/sub.yml";

const readerOf = (
  fetchWorkflow: FetchWorkflow,
  resolveRef: ResolveRef = async (src) => src.ref,
): WorkflowReader => ({ fetchWorkflow, resolveRef });

const readerFor = (files: Record<string, string>) =>
  readerOf(async (path) => files[path] ?? null);

describe("resolveCallee", () => {
  it("resolves a local callee against the caller's own source", async () => {
    const reader = readerFor({
      ".github/workflows/sub.yml": JSON.stringify({
        on: { workflow_call: { inputs: { e: { default: "x" } } } },
        jobs: { inner: {} },
      }),
    });
    const r = await resolveCallee(LOCAL, { m: "v" }, SOURCE, reader, 0, {
      github: { repository: "o/r" },
    });
    expect(r.failure).toBeNull();
    expect(r.subWf).toMatchObject({ jobs: { inner: {} } });
    expect(r.subSource).toBe(SOURCE);
    // `inputs.*` changes at the boundary; `github.*` crosses it untouched.
    expect(r.subScope).toEqual({
      inputs: { e: { kind: "value", v: "x" }, m: { kind: "value", v: "v" } },
      github: { repository: "o/r" },
    });
  });

  it("gives up past the four-level call chain GitHub allows", async () => {
    const r = await resolveCallee(LOCAL, undefined, SOURCE, readerFor({}), 4, {});
    expect(r.failure).toBe("reusable workflow nested deeper than 4 levels");
  });

  it("reports a reference it cannot turn into a fetch target", async () => {
    const r = await resolveCallee("not-a-reference", undefined, SOURCE, readerFor({}), 0, {});
    expect(r.failure).toBe("unresolvable reusable reference: not-a-reference");
  });

  it("reports a cross-repo ref that will not resolve", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const reader = readerOf(
      async () => null,
      async () => null,
    );
    const r = await resolveCallee(uses, undefined, SOURCE, reader, 0, {});
    expect(r.failure).toBe(`cannot resolve ref for ${uses}`);
  });

  it("pins a resolved cross-repo callee to the commit it read", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const sources: WorkflowSource[] = [];
    const reader = readerOf(async (path, src) => {
      sources.push(src);
      return path === ".github/workflows/x.yml"
        ? JSON.stringify({ on: { workflow_call: null }, jobs: { inner: {} } })
        : null;
    }, async () => REMOTE_SHA);
    const r = await resolveCallee(uses, undefined, SOURCE, reader, 0, {});
    expect(r.failure).toBeNull();
    expect(r.subSource).toMatchObject({ owner: "octo", repo: "repo", sha: REMOTE_SHA });
    expect(sources).toEqual([r.subSource]);
  });

  it("skips resolution for a ref already pinned to a commit", async () => {
    const uses = `octo/repo/.github/workflows/x.yml@${REMOTE_SHA}`;
    const reader = readerOf(async () => null, async () => {
      throw new Error("resolution must not run for a pinned sha");
    });
    const r = await resolveCallee(uses, undefined, SOURCE, reader, 0, {});
    expect(r.failure).toBe(`cannot fetch ${uses}`);
  });

  it("reports a callee it cannot fetch", async () => {
    const r = await resolveCallee(LOCAL, undefined, SOURCE, readerFor({}), 0, {});
    expect(r.failure).toBe(`cannot fetch ${LOCAL}`);
  });

  it("reports a callee that does not parse", async () => {
    const reader = readerFor({ ".github/workflows/sub.yml": "jobs:\n  a: [unclosed\n" });
    const r = await resolveCallee(LOCAL, undefined, SOURCE, reader, 0, {});
    expect(r.failure).toMatch(/^YAML parse error in \.\/\.github\/workflows\/sub\.yml: /);
  });

  it("hands back a null workflow, not a failure, for a file that parses to nothing", async () => {
    // The caller turns this into its `cannot resolve` entry; here there is
    // nothing wrong to report, just nothing to expand.
    const r = await resolveCallee(LOCAL, undefined, SOURCE, readerFor({ [".github/workflows/sub.yml"]: "" }), 0, {});
    expect(r.failure).toBeNull();
    expect(r.subWf).toBeNull();
  });
});
