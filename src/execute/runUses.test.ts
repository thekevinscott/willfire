import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runUses } from "./runUses.js";
import type { WalkCtx } from "./types.js";

const composite = (steps: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ runs: { using: "composite", steps }, ...extra });

async function treeWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wf-uses-"));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

function ctxOf(tree: string, depth = 0): WalkCtx {
  return {
    tree,
    envLayers: [],
    deps: {
      runCommand: async () => ({ code: 0, stderr: "" }),
      provideTree: async () => null,
      resolveRef: async (src) => src.ref,
    },
    depth,
  };
}

describe("runUses", () => {
  it("satisfies a bare actions/checkout, refusing one with inputs", async () => {
    const ctx = ctxOf("/ws");
    expect(await runUses({ uses: "actions/checkout@v6" }, "step 's'", {}, ctx)).toEqual({
      ok: true,
      v: {},
    });
    const withInputs = await runUses(
      { uses: "actions/checkout@v6", with: { ref: "main" } },
      "step 's'",
      {},
      ctx,
    );
    expect(withInputs).toEqual({
      ok: false,
      reason: "step 's': actions/checkout with inputs is not modelled",
    });
  });

  it("stops at the nesting cap", async () => {
    const r = await runUses({ uses: "./a" }, "step 's'", {}, ctxOf("/ws", 4));
    expect(r).toEqual({ ok: false, reason: "step 's': actions nested deeper than 4 levels" });
  });

  it("runs a workspace-relative composite and evaluates its outputs", async () => {
    const tree = await treeWith({
      "action/action.yml": composite([{ id: "s", shell: "bash", run: "true" }], {
        outputs: { v: { value: "fixed" } },
      }),
    });
    const r = await runUses({ uses: "./action" }, "step 's'", {}, ctxOf(tree));
    expect(r).toEqual({ ok: true, v: { v: "fixed" } });
  });

  it("stops on a uses it cannot parse", async () => {
    const r = await runUses({ uses: "actions/setup-node" }, "step 's'", {}, ctxOf("/ws"));
    expect(r).toEqual({ ok: false, reason: "step 's': unresolvable uses: actions/setup-node" });
  });

  it("stops when there is no action.yml where uses points", async () => {
    const tree = await treeWith({});
    const r = await runUses({ uses: "./missing" }, "step 's'", {}, ctxOf(tree));
    expect(r).toEqual({ ok: false, reason: "step 's': no action.yml under ./missing" });
  });

  it("refuses a non-composite action", async () => {
    const tree = await treeWith({
      "action/action.yml": JSON.stringify({ runs: { using: "node20", main: "index.js" } }),
    });
    const r = await runUses({ uses: "./action" }, "step 's'", {}, ctxOf(tree));
    expect(r).toEqual({
      ok: false,
      reason: "step 's': action ./action runs via 'node20'; only composite actions are executed",
    });
  });

  it("prefixes a child step's failure with the action it happened in", async () => {
    const tree = await treeWith({ "action/action.yml": composite([{}]) });
    const r = await runUses({ uses: "./action" }, "step 's'", {}, ctxOf(tree));
    expect(r).toEqual({
      ok: false,
      reason: "step 's' (./action): step '#1' has neither uses nor run",
    });
  });
});
