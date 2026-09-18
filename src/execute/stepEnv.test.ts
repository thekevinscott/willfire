import { afterEach, describe, expect, it, vi } from "vitest";
import { stepEnv } from "./stepEnv.js";
import type { RunCommand, WalkCtx } from "./types.js";

const noop: RunCommand = async () => ({ code: 0, stdout: "", stderr: "" });

const ctxOf = (envLayers: WalkCtx["envLayers"] = []): WalkCtx => ({
  tree: "/nonexistent-tree",
  hasHistory: false,
  envLayers,
  deps: {
    provideTree: async () => null,
    runCommand: noop,
    resolveRef: async (s) => s.ref,
    nodeMajor: 24,
  },
  depth: 0,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stepEnv", () => {
  it("hands over the github env the runner provides", () => {
    const scope = { github: { repository: "o/r", event_name: "pull_request" } };
    const built = stepEnv({}, scope, ctxOf(), "step 's'");
    expect(built).toEqual({
      ok: true,
      v: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_WORKSPACE: "/nonexistent-tree",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_EVENT_NAME: "pull_request",
      },
    });
  });

  it("leaves out the repository and event name the scope does not carry", () => {
    const built = stepEnv({}, {}, ctxOf(), "step 's'");
    expect(built.ok && built.v).not.toHaveProperty("GITHUB_REPOSITORY");
    expect(built.ok && built.v).not.toHaveProperty("GITHUB_EVENT_NAME");
  });

  it("gives PATH and HOME empty values when the host has neither", () => {
    vi.stubEnv("PATH", undefined);
    vi.stubEnv("HOME", undefined);
    const built = stepEnv({}, {}, ctxOf(), "step 's'");
    expect(built.ok && built.v.PATH).toBe("");
    expect(built.ok && built.v.HOME).toBe("");
  });

  it("layers the caller's own keys over the base", () => {
    const built = stepEnv({}, {}, ctxOf(), "step 's'", { GITHUB_ACTION_PATH: "/root/a" });
    expect(built.ok && built.v.GITHUB_ACTION_PATH).toBe("/root/a");
  });

  it("lets a step's env: outrank both the caller's keys and the outer layers", () => {
    const built = stepEnv({ env: { K: "step" } }, {}, ctxOf([{ K: "job" }]), "step 's'", {
      K: "caller",
    });
    expect(built.ok && built.v.K).toBe("step");
  });

  it("applies the outer layers in order", () => {
    const built = stepEnv({}, {}, ctxOf([{ K: "first" }, { K: "second" }]), "step 's'");
    expect(built.ok && built.v.K).toBe("second");
  });

  it("stops on a layer it cannot render, naming the step", () => {
    const built = stepEnv({ env: { K: "${{ env.nope }}" } }, {}, ctxOf(), "step 's'");
    expect(built).toEqual({ ok: false, reason: "step 's': cannot resolve env 'K'" });
  });
});
