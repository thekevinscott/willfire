import { stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { scratch } from "./scratch.js";

// The isolation gate wants collaborators mocked; a real directory on disk is
// what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

describe("scratch", () => {
  it("creates a directory under the temp root, named for the prefix", async () => {
    const s = await scratch("willfire-scratch-test-");
    expect(dirname(s.dir)).toBe(tmpdir());
    expect(basename(s.dir)).toMatch(/^willfire-scratch-test-/);
    expect(await exists(s.dir)).toBe(true);
    await s.remove();
  });

  it("hands out a fresh directory per call", async () => {
    const a = await scratch("willfire-scratch-test-");
    const b = await scratch("willfire-scratch-test-");
    expect(a.dir).not.toBe(b.dir);
    await a.remove();
    await b.remove();
  });

  it("removes the directory and everything under it", async () => {
    const s = await scratch("willfire-scratch-test-");
    await writeFile(join(s.dir, "f"), "x");
    await s.remove();
    expect(await exists(s.dir)).toBe(false);
  });

  it("takes a second remove without throwing", async () => {
    const s = await scratch("willfire-scratch-test-");
    await s.remove();
    await expect(s.remove()).resolves.toBeUndefined();
  });
});
