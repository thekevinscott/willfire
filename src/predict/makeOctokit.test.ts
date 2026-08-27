import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOctokit } from "./makeOctokit.js";

const hoisted = vi.hoisted(() => ({ authSeen: [] as (string | undefined)[] }));

vi.mock("@octokit/rest", async () => {
  const actual = await vi.importActual<typeof import("@octokit/rest")>("@octokit/rest");
  return {
    ...actual,
    Octokit: class {
      constructor(options: { auth?: string }) {
        hoisted.authSeen.push(options.auth);
        return {};
      }
    },
  };
});

describe("makeOctokit", () => {
  beforeEach(() => {
    hoisted.authSeen.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to build a client with no token in the environment", () => {
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", undefined);
    expect(() => makeOctokit()).toThrow("GH_TOKEN or GITHUB_TOKEN must be set");
  });

  it("prefers GH_TOKEN", () => {
    vi.stubEnv("GH_TOKEN", "gh");
    vi.stubEnv("GITHUB_TOKEN", "gha");
    makeOctokit();
    expect(hoisted.authSeen).toEqual(["gh"]);
  });

  it("falls back to GITHUB_TOKEN", () => {
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", "gha");
    makeOctokit();
    expect(hoisted.authSeen).toEqual(["gha"]);
  });
});
