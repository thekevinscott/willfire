import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readActionManifest } from "./readActionManifest.js";

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
