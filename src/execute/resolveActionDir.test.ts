import { describe, expect, it } from "vitest";
import { resolveActionDir } from "./resolveActionDir.js";
import type { WalkCtx } from "./walkCtx.js";

const SHA = "d".repeat(40);

const ctx = (deps: Record<string, unknown> = {}, tree = "/ws"): WalkCtx =>
  ({ tree, deps }) as unknown as WalkCtx;

describe("resolveActionDir", () => {
  it("maps a local ./ uses into the workspace tree, with no root", async () => {
    const r = await resolveActionDir("./.github/actions/build", "step '#1'", ctx());
    expect(r).toEqual({ ok: true, v: { actionDir: "/ws/.github/actions/build" } });
  });

  it("rejects a reference it cannot parse", async () => {
    const r = await resolveActionDir("docker://alpine", "step '#1'", ctx());
    expect(r).toEqual({ ok: false, reason: "step '#1': unresolvable uses: docker://alpine" });
  });

  it("materializes a repo-root action, recording its root", async () => {
    const c = ctx({
      resolveRef: async () => SHA,
      provideTree: async (src: { owner: string; repo: string; sha: string }) =>
        `/trees/${src.owner}-${src.repo}-${src.sha}`,
    });
    const r = await resolveActionDir("own/act@v1", "step '#1'", c);
    expect(r).toEqual({
      ok: true,
      v: { actionDir: `/trees/own-act-${SHA}`, actionRoot: `/trees/own-act-${SHA}` },
    });
  });

  it("joins a subdirectory action onto the materialized root", async () => {
    const c = ctx({ resolveRef: async () => SHA, provideTree: async () => "/root" });
    const r = await resolveActionDir("own/act/sub/dir@v1", "step '#1'", c);
    expect(r).toEqual({ ok: true, v: { actionDir: "/root/sub/dir", actionRoot: "/root" } });
  });

  it("skips ref resolution when the ref is already a sha", async () => {
    const c = ctx({
      resolveRef: async () => {
        throw new Error("must not resolve");
      },
      provideTree: async (src: { sha: string }) => `/pinned/${src.sha}`,
    });
    const r = await resolveActionDir(`own/act@${SHA}`, "step '#1'", c);
    expect(r).toEqual({ ok: true, v: { actionDir: `/pinned/${SHA}`, actionRoot: `/pinned/${SHA}` } });
  });

  it("fails when the ref cannot be resolved", async () => {
    const c = ctx({ resolveRef: async () => null });
    const r = await resolveActionDir("own/act@gone", "step '#1'", c);
    expect(r).toEqual({ ok: false, reason: "step '#1': cannot resolve ref for own/act@gone" });
  });

  it("fails when the tree cannot be materialized", async () => {
    const c = ctx({ resolveRef: async () => SHA, provideTree: async () => null });
    const r = await resolveActionDir("own/act@v1", "step '#1'", c);
    expect(r).toEqual({ ok: false, reason: `step '#1': cannot materialize own/act@${SHA}` });
  });
});
