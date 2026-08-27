import { describe, expect, it } from "vitest";
import { resolveReusable } from "./resolveReusable.js";
import type { Scope } from "../expr/val.js";
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

const resolve = (
  uses: string,
  reader: WorkflowReader,
  withBlock: unknown = undefined,
  depth = 0,
  scoped: Scope = {},
) => resolveReusable(uses, withBlock, depth, reader, SOURCE, scoped);

describe("resolveReusable", () => {
  it("refuses a call past the four-level depth cap", async () => {
    const res = await resolve(LOCAL, readerOf(async () => null), undefined, 4);
    expect(res.failure).toBe("reusable workflow nested deeper than 4 levels");
    expect(res.subWf).toBe(null);
  });

  it("refuses a reference it cannot parse", async () => {
    const res = await resolve("not-a-reference", readerOf(async () => null));
    expect(res.failure).toBe("unresolvable reusable reference: not-a-reference");
  });

  it("reports a cross-repo ref that will not resolve", async () => {
    const uses = "octo/repo/.github/workflows/x.yml@v1";
    const res = await resolve(uses, readerOf(async () => null, async () => null));
    expect(res.failure).toBe(`cannot resolve ref for ${uses}`);
  });

  it("skips resolution for a uses already pinned to a commit", async () => {
    const uses = `octo/repo/.github/workflows/x.yml@${REMOTE_SHA}`;
    const reader = readerOf(
      async () => null,
      async () => {
        throw new Error("resolution must not run for a pinned sha");
      },
    );
    const res = await resolve(uses, reader);
    expect(res.failure).toBe(`cannot fetch ${uses}`);
  });

  it("reports a callee it cannot fetch", async () => {
    const res = await resolve(LOCAL, readerOf(async () => null));
    expect(res.failure).toBe(`cannot fetch ${LOCAL}`);
  });

  it("reports a callee that does not parse", async () => {
    const res = await resolve(LOCAL, readerOf(async () => "jobs:\n  a: [unclosed\n"));
    expect(res.failure).toMatch(/^YAML parse error in \.\/\.github\/workflows\/sub\.yml: /);
  });

  it("leaves a callee that parses to nothing to the caller", async () => {
    const res = await resolve(LOCAL, readerOf(async () => ""));
    expect(res).toMatchObject({ subWf: null, failure: null });
  });

  it("resolves a local callee on the caller's own source", async () => {
    const sub = {
      on: { workflow_call: { inputs: { x: { default: "d" } } } },
      jobs: { inner: {} },
    };
    const reader = readerOf(async () => JSON.stringify(sub));
    const res = await resolve(LOCAL, reader, { y: "z" }, 0, {
      github: { repository: "o/r" },
    });
    expect(res.failure).toBe(null);
    expect(res.subWf).toEqual(sub);
    expect(res.subSource).toBe(SOURCE);
    expect(res.subScope).toEqual({
      inputs: { x: { kind: "value", v: "d" }, y: { kind: "value", v: "z" } },
      github: { repository: "o/r" },
    });
  });

  it("resolves a cross-repo callee at its pinned commit", async () => {
    const fetched: WorkflowSource[] = [];
    const reader = readerOf(
      async (_path, src) => {
        fetched.push(src);
        return JSON.stringify({ on: { workflow_call: null }, jobs: {} });
      },
      async () => REMOTE_SHA,
    );
    const res = await resolve("octo/repo/.github/workflows/x.yml@v1", reader);
    expect(res.failure).toBe(null);
    expect(res.subSource).toEqual({ owner: "octo", repo: "repo", ref: "v1", sha: REMOTE_SHA });
    expect(fetched).toEqual([res.subSource]);
  });
});
