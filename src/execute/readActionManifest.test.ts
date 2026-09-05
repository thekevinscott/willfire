import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readActionManifest } from "./readActionManifest.js";

// The isolation gate wants collaborators mocked; reading real files is what
// this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));

describe("readActionManifest", () => {
  it("reads action.yml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-manifest-test-"));
    await writeFile(join(dir, "action.yml"), "yml-content");
    expect(await readActionManifest(dir)).toBe("yml-content");
  });

  it("falls back to the action.yaml spelling", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-manifest-test-"));
    await writeFile(join(dir, "action.yaml"), "yaml-content");
    expect(await readActionManifest(dir)).toBe("yaml-content");
  });

  it("yields null when neither spelling exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-manifest-test-"));
    expect(await readActionManifest(dir)).toBe(null);
  });
});
