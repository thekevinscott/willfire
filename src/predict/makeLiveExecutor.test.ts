// The live executor is wiring; these tests pin the wiring — which provider a
// request routes to, where clone auth comes from — not the pieces themselves.

import type { Octokit } from "@octokit/rest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runShell } from "../execute/runShell.js";
import { makeLiveExecutor } from "./makeLiveExecutor.js";
import type { WorkflowSource } from "../types.js";

const hoisted = vi.hoisted(() => ({
  makeCloneProvider: vi.fn(),
}));

// The real module, with a spy on `makeCloneProvider` to observe the token.
vi.mock("../execute/makeCloneProvider.js", async () => {
  const actual = await vi.importActual<typeof import("../execute/makeCloneProvider.js")>(
    "../execute/makeCloneProvider.js",
  );
  hoisted.makeCloneProvider.mockImplementation(actual.makeCloneProvider);
  return { makeCloneProvider: hoisted.makeCloneProvider };
});

vi.mock("../execute/runShell.js", async () => {
  const actual = await vi.importActual<typeof import("../execute/runShell.js")>(
    "../execute/runShell.js",
  );
  return { ...actual };
});

const SHA = "c".repeat(40);
const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

const resolveRef = async (): Promise<string | null> => null;

/** A real gzipped tarball, `o-r-ccccccc/file.txt` = "content". */
const WRAPPED_TB = "H4sIAAAAAAAAA+3S0QrCIBSA4fMovsCcw6nPE2ODICaYQY/fqqvGWAQzqP3fzRH0QvnVtRRnJiG4x5zM58I6eNeKcuWvJnI550NSSlKMee3cu/0fpetYpap7KvQXPu7fNKGx9P+G1/7D8dTrfN34ofeo3rcr/cOsv7XBiDLbXmPZzvt3ccz9+I8vAwAAAAAAAAAAAAAA2IcbvGawBgAoAAA=";

/** An Octokit whose only implemented route is the tarball download. */
function octokitOf(tarballs: Record<string, string>): Octokit {
  const api = {
    rest: {
      repos: {
        downloadTarballArchive: async ({ owner, repo, ref }: Record<string, string>) => {
          const b64 = tarballs[`${owner}/${repo}@${ref}`];
          if (b64 == null) throw new Error(`404 tarball ${owner}/${repo}@${ref}`);
          return { data: new Uint8Array(Buffer.from(b64, "base64")).buffer };
        },
      },
    },
  };
  return api as unknown as Octokit;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("makeLiveExecutor", () => {
  it("serves a plain job from the tarball endpoint, end to end", async () => {
    const ex = makeLiveExecutor(octokitOf({ [`o/r@${SHA}`]: WRAPPED_TB }), WORKSPACE, resolveRef, {
      // The host shell stands in for the sandbox, which has its own suite.
      runCommand: runShell,
      token: null,
    });
    const o = await ex.executeJob(
      "detect",
      {
        steps: [{ id: "s", run: 'echo "f=$(cat file.txt)" >> "$GITHUB_OUTPUT"' }],
        outputs: { f: "${{ steps.s.outputs.f }}" },
      },
      {},
      {},
    );
    expect(o).toEqual({ ok: true, outputs: { f: "content" } });
  });

  it("fails the job when the tarball is not served", async () => {
    const ex = makeLiveExecutor(octokitOf({}), WORKSPACE, resolveRef, {
      runCommand: runShell,
      token: null,
    });
    const o = await ex.executeJob("detect", { steps: [{ run: "true" }] }, {}, {});
    expect(o).toEqual({ ok: false, reason: `cannot materialize workspace o/r@${SHA}` });
  });

  it("routes a history request to the clone provider, not the tarball", async () => {
    // The tarball exists but the clone remote does not: failing proves routing.
    const ex = makeLiveExecutor(octokitOf({ [`o/r@${SHA}`]: WRAPPED_TB }), WORKSPACE, resolveRef, {
      runCommand: runShell,
      token: null,
      remoteUrl: () => "file:///nonexistent-willfire-remote",
    });
    const o = await ex.executeJob(
      "detect",
      { steps: [{ uses: "actions/checkout@v6", with: { "fetch-depth": 0 } }] },
      {},
      {},
    );
    expect(o).toEqual({ ok: false, reason: `cannot materialize workspace o/r@${SHA}` });
  });

  it("reads clone auth from the environment only when no token is given", () => {
    // Construction is where the token is read; nothing here executes.
    hoisted.makeCloneProvider.mockClear();
    vi.stubEnv("GH_TOKEN", "from-gh-token");
    vi.stubEnv("GITHUB_TOKEN", "from-github-token");
    makeLiveExecutor(octokitOf({}), WORKSPACE, resolveRef);
    vi.stubEnv("GH_TOKEN", undefined);
    makeLiveExecutor(octokitOf({}), WORKSPACE, resolveRef);
    vi.stubEnv("GITHUB_TOKEN", undefined);
    makeLiveExecutor(octokitOf({}), WORKSPACE, resolveRef);
    makeLiveExecutor(octokitOf({}), WORKSPACE, resolveRef, { token: "explicit" });
    expect(hoisted.makeCloneProvider.mock.calls.map((c) => c[1])).toEqual([
      "from-gh-token",
      "from-github-token",
      null,
      "explicit",
    ]);
  });
});
