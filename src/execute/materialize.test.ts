import { stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { materialize } from "./materialize.js";
import type { WorkflowSource } from "../types.js";
import type { RunSpec } from "./types.js";

// The isolation gate wants collaborators mocked; whether the scratch survives
// is what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock(
  "./scratch.js",
  async () => await vi.importActual<typeof import("./scratch.js")>("./scratch.js"),
);

const SHA = "c".repeat(40);
const SOURCE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

describe("materialize", () => {
  it("hands a failed download through as null", async () => {
    expect(
      await materialize(SOURCE, async () => null, async () => ({ code: 0, stdout: "", stderr: "" })),
    ).toBe(null);
  });

  it("gives the extraction one writable mount holding both the archive and the destination", async () => {
    const specs: RunSpec[] = [];
    await materialize(SOURCE, async () => new Uint8Array([1, 2, 3]), async (s) => {
      specs.push(s);
      return { code: 1, stdout: "", stderr: "" };
    });
    const [seen] = specs;
    expect(seen.mounts).toEqual([{ path: seen.cwd, writable: true }]);
    expect(seen.env.WILLFIRE_ARCHIVE).toBe(`${seen.cwd}/tree.tar.gz`);
    expect(seen.env.WILLFIRE_DEST).toBe(`${seen.cwd}/tree`);
  });

  it("hands a failed extraction through as null, leaving no scratch behind", async () => {
    let scratchDir = "";
    const r = await materialize(
      SOURCE,
      async () => new Uint8Array([1, 2, 3]),
      async (spec) => {
        scratchDir = spec.cwd;
        return { code: 1, stdout: "", stderr: "" };
      },
    );
    expect(r).toBe(null);
    await expect(stat(scratchDir)).rejects.toThrow();
  });
});
