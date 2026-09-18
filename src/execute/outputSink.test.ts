import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { outputSink } from "./outputSink.js";

// The isolation gate wants collaborators mocked; making a real sink on disk is
// what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));

describe("outputSink", () => {
  it("creates the file empty, inside a directory of its own", async () => {
    const env: Record<string, string> = {};
    const { dir, file } = await outputSink(env);
    expect(dirname(file)).toBe(dir);
    expect(basename(dirname(file))).toMatch(/^willfire-out-/);
    expect(await readFile(file, "utf8")).toBe("");
  });

  it("points GITHUB_OUTPUT at the file", async () => {
    const env: Record<string, string> = {};
    const { file } = await outputSink(env);
    expect(env.GITHUB_OUTPUT).toBe(file);
  });

  it("overrides a GITHUB_OUTPUT an env: layer already set", async () => {
    const env: Record<string, string> = { GITHUB_OUTPUT: "/somewhere/else" };
    const { file } = await outputSink(env);
    expect(env.GITHUB_OUTPUT).toBe(file);
  });

  it("hands out a fresh directory per call", async () => {
    const a = await outputSink({});
    const b = await outputSink({});
    expect(a.dir).not.toBe(b.dir);
  });
});
