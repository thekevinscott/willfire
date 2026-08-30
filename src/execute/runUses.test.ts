import { beforeEach, describe, expect, it, vi } from "vitest";
import { runUses } from "./runUses.js";
import type { ExecDeps, WalkCtx } from "./types.js";

// The manifest read is the one collaborator this suite stubs: it stands in for
// the action tree on disk, so a manifest shape is a value here rather than a
// fixture.
const manifests = vi.hoisted(() => ({ text: null as string | null, dirs: [] as string[] }));
vi.mock("./readActionManifest.js", async () => ({
  ...(await vi.importActual<typeof import("./readActionManifest.js")>("./readActionManifest.js")),
  readActionManifest: async (dir: string) => {
    manifests.dirs.push(dir);
    return manifests.text;
  },
}));

const SHA = "a".repeat(40);

const ctxOf = (depth = 0, deps: Partial<ExecDeps> = {}): WalkCtx => ({
  tree: "/nonexistent-tree",
  hasHistory: false,
  envLayers: [],
  deps: {
    provideTree: async () => null,
    runCommand: async () => ({ code: 0, stderr: "" }),
    resolveRef: async (s) => s.ref,
    nodeMajor: 24,
    ...deps,
  },
  depth,
});

/** A `uses:` with a `node-version:`, the only setup-node input that is modelled. */
const setupNode = async (version: unknown) =>
  await runUses(
    { uses: "actions/setup-node@v5", with: { "node-version": version } },
    "step '#1'",
    {},
    ctxOf(),
  );

beforeEach(() => {
  manifests.text = null;
  manifests.dirs = [];
});

describe("runUses", () => {
  it("satisfies a bare checkout as an already-true postcondition", async () => {
    expect(await runUses({ uses: "actions/checkout@v6" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: true,
      v: {},
    });
  });

  it("satisfies a bare setup-node", async () => {
    expect(await runUses({ uses: "actions/setup-node@v5" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: true,
      v: {},
    });
  });

  it("recognises the runner-provided actions only at the start of the uses", async () => {
    // A third-party action whose name merely contains one is resolved like any
    // other, not waved through as already satisfied.
    for (const [uses, ref] of [
      ["myorg/actions/checkout@v6", "v6"],
      ["myorg/actions/setup-node@v5", "v5"],
    ]) {
      expect(await runUses({ uses }, "step '#1'", {}, ctxOf())).toEqual({
        ok: false,
        reason: `step '#1': cannot materialize myorg/actions@${ref}`,
      });
    }
  });

  it("takes a 40-character hex ref as a commit and skips the resolver", async () => {
    const ctx = ctxOf(0, { resolveRef: async () => "resolved" });
    expect(await runUses({ uses: `o/r@${SHA}` }, "step '#1'", {}, ctx)).toEqual({
      ok: false,
      reason: `step '#1': cannot materialize o/r@${SHA}`,
    });
  });

  it("resolves any ref that is not exactly 40 hex characters", async () => {
    const ctx = ctxOf(0, { resolveRef: async () => "resolved" });
    for (const ref of [`refs/tags/${SHA}`, `${SHA}0`]) {
      expect(await runUses({ uses: `o/r@${ref}` }, "step '#1'", {}, ctx)).toEqual({
        ok: false,
        reason: "step '#1': cannot materialize o/r@resolved",
      });
    }
  });

  it("trims a node-version before reading a major out of it", async () => {
    expect(await setupNode(" 24 ")).toEqual({ ok: true, v: {} });
  });

  it("reads the major out of a dotted node-version", async () => {
    expect(await setupNode("24.1.0")).toEqual({ ok: true, v: {} });
  });

  it("refuses a node-version the major is only a fragment of", async () => {
    // The whole version has to be a version: neither a leading nor a trailing
    // digit run stands in for one.
    for (const version of ["24 lts", "node24"]) {
      expect(await setupNode(version)).toEqual({
        ok: false,
        reason: `step '#1': setup-node wants node ${version}; the sandbox has node 24`,
      });
    }
  });

  it("stops at the nesting cap before resolving the action", async () => {
    expect(await runUses({ uses: "./action" }, "step '#1'", {}, ctxOf(4))).toEqual({
      ok: false,
      reason: "step '#1': actions nested deeper than 4 levels",
    });
  });

  it("resolves the action one level below the cap", async () => {
    expect(await runUses({ uses: "./action" }, "step '#1'", {}, ctxOf(3))).toEqual({
      ok: false,
      reason: "step '#1': no action.yml under ./action",
    });
  });

  it("resolves a local uses against the workspace root, stripping the ./", async () => {
    await runUses({ uses: "./" }, "step '#1'", {}, ctxOf());
    expect(manifests.dirs).toEqual(["/nonexistent-tree"]);
  });

  it("uses the materialized root as given for an action at the repo root", async () => {
    // Handed through, not re-normalized: there is no subpath to join on.
    const ctx = ctxOf(0, { provideTree: async () => "/materialized/." });
    await runUses({ uses: `o/r@${SHA}` }, "step '#1'", {}, ctx);
    expect(manifests.dirs).toEqual(["/materialized/."]);
  });

  it("joins a subdirectory uses onto the materialized root", async () => {
    const ctx = ctxOf(0, { provideTree: async () => "/materialized" });
    await runUses({ uses: `o/r/sub@${SHA}` }, "step '#1'", {}, ctx);
    expect(manifests.dirs).toEqual(["/materialized/sub"]);
  });

  it("stops on a uses it cannot parse", async () => {
    expect(await runUses({ uses: "docker://alpine:3" }, "step '#1'", {}, ctxOf())).toEqual({
      ok: false,
      reason: "step '#1': unresolvable uses: docker://alpine:3",
    });
  });

  it("stops on a manifest that yields no runs block", async () => {
    // An empty action.yml parses to null and one with no `runs:` to a bare map.
    for (const text of ["", "{}"]) {
      manifests.text = text;
      expect(await runUses({ uses: "./a" }, "step '#1'", {}, ctxOf())).toEqual({
        ok: false,
        reason:
          "step '#1': action ./a runs via 'undefined'; only composite and node actions are executed",
      });
    }
  });

  it("treats only an exact nodeNN as a node action", async () => {
    for (const using of ["node24x", "xnode24"]) {
      manifests.text = JSON.stringify({ runs: { using } });
      expect(await runUses({ uses: "./a" }, "step '#1'", {}, ctxOf())).toEqual({
        ok: false,
        reason: `step '#1': action ./a runs via '${using}'; only composite and node actions are executed`,
      });
    }
  });
});
