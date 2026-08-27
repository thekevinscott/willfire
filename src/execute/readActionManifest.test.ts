import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readActionManifest } from "./readActionManifest.js";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual };
});
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual };
});
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual };
});

const freshDir = () => mkdtemp(join(tmpdir(), "wf-manifest-"));

describe("readActionManifest", () => {
  it("reads action.yml, preferring it over action.yaml", async () => {
    const dir = await freshDir();
    await writeFile(join(dir, "action.yml"), "yml-content");
    await writeFile(join(dir, "action.yaml"), "yaml-content");
    expect(await readActionManifest(dir)).toBe("yml-content");
  });

  it("falls back to the action.yaml spelling", async () => {
    const dir = await freshDir();
    await writeFile(join(dir, "action.yaml"), "yaml-content");
    expect(await readActionManifest(dir)).toBe("yaml-content");
  });

  it("returns null when neither spelling exists", async () => {
    expect(await readActionManifest(await freshDir())).toBe(null);
  });
});
