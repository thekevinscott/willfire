import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { grantedExecutor } from "./grantedExecutor.js";
import type { WorkflowSource } from "../types.js";

const SHA = "c".repeat(40);
const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const resolveRef = async (): Promise<string | null> => null;

const WRAPPED_TB = "H4sIAAAAAAAAA+3S0QrCIBSA4fMovsCcw6nPE2ODICaYQY/fqqvGWAQzqP3fzRH0QvnVtRRnJiG4x5zM58I6eNeKcuWvJnI550NSSlKMee3cu/0fpetYpap7KvQXPu7fNKGx9P+G1/7D8dTrfN34ofeo3rcr/cOsv7XBiDLbXmPZzvt3ccz9+I8vAwAAAAAAAAAAAAAA2IcbvGawBgAoAAA=";

function fake(tarball: Uint8Array | null): Octokit {
  return {
    rest: {
      repos: {
        downloadTarballArchive: async () => {
          if (tarball == null) {
            throw new Error("no tarball");
          }
          return { data: tarball.buffer };
        },
      },
    },
  } as unknown as Octokit;
}

describe("grantedExecutor", () => {
  it("declines to build an executor without grants", () => {
    expect(grantedExecutor(fake(null), WORKSPACE, resolveRef, undefined)).toBe(undefined);
    expect(grantedExecutor(fake(null), WORKSPACE, resolveRef, [])).toBe(undefined);
  });

  it("grants exactly the repo and job ids it was given", () => {
    const executor = grantedExecutor(fake(null), WORKSPACE, resolveRef, [
      { repo: "o/r", jobs: ["detect"] },
    ]);
    const at = (owner: string, repo: string): WorkflowSource => ({ owner, repo, ref: "x", sha: SHA });
    expect(executor?.granted(at("o", "r"), "detect")).toBe(true);
    expect(executor?.granted(at("o", "r"), "other")).toBe(false);
    expect(executor?.granted(at("o", "other"), "detect")).toBe(false);
  });

  it("materializes the workspace tarball and executes a job in it", async () => {
    const bytes = new Uint8Array(Buffer.from(WRAPPED_TB, "base64"));
    const executor = grantedExecutor(fake(bytes), WORKSPACE, resolveRef, [
      { repo: "o/r", jobs: ["detect"] },
    ]);
    const job = { steps: [{ id: "s", run: "true" }], outputs: { x: "fixed" } };
    expect(await executor?.executeJob("detect", job, {}, {})).toEqual({
      ok: true,
      outputs: { x: "fixed" },
    });
  });

  it("reports a workspace it cannot download", async () => {
    const executor = grantedExecutor(fake(null), WORKSPACE, resolveRef, [
      { repo: "o/r", jobs: ["detect"] },
    ]);
    const job = { steps: [{ run: "true" }] };
    expect(await executor?.executeJob("detect", job, {}, {})).toEqual({
      ok: false,
      reason: `cannot materialize workspace o/r@${SHA}`,
    });
  });
});
