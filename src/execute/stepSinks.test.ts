import { readFile, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stepSinks } from "./stepSinks.js";

// The isolation gate wants collaborators mocked; making real sinks on disk is
// what this suite pins, so the mocks pass the real modules through.
vi.mock(
  "node:fs/promises",
  async () => await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
);
vi.mock("node:os", async () => await vi.importActual<typeof import("node:os")>("node:os"));
vi.mock("node:path", async () => await vi.importActual<typeof import("node:path")>("node:path"));
vi.mock(
  "./scratch.js",
  async () => await vi.importActual<typeof import("./scratch.js")>("./scratch.js"),
);

describe("stepSinks", () => {
  it("creates both files empty, inside a directory of their own", async () => {
    const env: Record<string, string> = {};
    const { dir, outputFile, envFile } = await stepSinks(env);
    expect(dirname(outputFile)).toBe(dir);
    expect(dirname(envFile)).toBe(dir);
    expect(basename(dirname(outputFile))).toMatch(/^willfire-out-/);
    expect(await readFile(outputFile, "utf8")).toBe("");
    expect(await readFile(envFile, "utf8")).toBe("");
  });

  it("points GITHUB_OUTPUT and GITHUB_ENV at their files", async () => {
    const env: Record<string, string> = {};
    const { outputFile, envFile } = await stepSinks(env);
    expect(env.GITHUB_OUTPUT).toBe(outputFile);
    expect(env.GITHUB_ENV).toBe(envFile);
  });

  it("overrides sink paths an env: layer already set", async () => {
    const env: Record<string, string> = {
      GITHUB_OUTPUT: "/somewhere/else",
      GITHUB_ENV: "/somewhere/else",
    };
    const { outputFile, envFile } = await stepSinks(env);
    expect(env.GITHUB_OUTPUT).toBe(outputFile);
    expect(env.GITHUB_ENV).toBe(envFile);
  });

  it("hands out a fresh directory per call", async () => {
    const a = await stepSinks({});
    const b = await stepSinks({});
    expect(a.dir).not.toBe(b.dir);
  });

  it("removes the directory, files included, on request", async () => {
    const { dir, outputFile, envFile, remove } = await stepSinks({});
    await remove();
    await expect(stat(dir)).rejects.toThrow();
    await expect(stat(outputFile)).rejects.toThrow();
    await expect(stat(envFile)).rejects.toThrow();
  });
});
