import { describe, expect, it, vi } from "vitest";
import { readActionManifest } from "./readActionManifest.js";

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const readFile = vi.fn(async (path: string) => {
    const hit = h.files[path];
    if (hit === undefined) {
      throw new Error("ENOENT");
    }
    return hit;
  });
  return { ...actual, readFile: readFile as unknown as typeof actual.readFile };
});

describe("readActionManifest", () => {
  it("reads action.yml", async () => {
    h.files = { "/a/action.yml": "yml-content", "/a/action.yaml": "yaml-content" };
    expect(await readActionManifest("/a")).toBe("yml-content");
  });

  it("falls back to the action.yaml spelling", async () => {
    h.files = { "/a/action.yaml": "yaml-content" };
    expect(await readActionManifest("/a")).toBe("yaml-content");
  });

  it("yields null when neither spelling is there", async () => {
    h.files = {};
    expect(await readActionManifest("/a")).toBe(null);
  });
});
