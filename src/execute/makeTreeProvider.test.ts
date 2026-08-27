import { describe, expect, it, vi } from "vitest";
import { makeTreeProvider } from "./makeTreeProvider.js";
import { runShell } from "./runShell.js";
import type { WorkflowSource } from "../types.js";

vi.mock("./runShell.js", async () => {
  const actual = await vi.importActual<typeof import("./runShell.js")>("./runShell.js");
  return { ...actual };
});

const SHA = "c".repeat(40);
const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };

async function fileIs(path: string, want: string): Promise<boolean> {
  const r = await runShell({
    script: '[ "$(cat "$F")" = "$W" ]',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, F: path, W: want },
  });
  return r.code === 0;
}

const tarball = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, "base64"));

const WRAPPED_TB = "H4sIAAAAAAAAA+3S0QrCIBSA4fMovsCcw6nPE2ODICaYQY/fqqvGWAQzqP3fzRH0QvnVtRRnJiG4x5zM58I6eNeKcuWvJnI550NSSlKMee3cu/0fpetYpap7KvQXPu7fNKGx9P+G1/7D8dTrfN34ofeo3rcr/cOsv7XBiDLbXmPZzvt3ccz9+I8vAwAAAAAAAAAAAAAA2IcbvGawBgAoAAA=";

describe("makeTreeProvider", () => {
  it("downloads once per commit and shares the materialized tree", async () => {
    let downloads = 0;
    const provide = makeTreeProvider(async () => {
      downloads++;
      return tarball(WRAPPED_TB);
    }, runShell);
    const first = await provide(WORKSPACE);
    const second = await provide(WORKSPACE);
    expect(second).toBe(first);
    expect(downloads).toBe(1);
    expect(await fileIs(`${first}/file.txt`, "content")).toBe(true);
  });

  it("caches per commit, not per repo", async () => {
    let downloads = 0;
    const provide = makeTreeProvider(async () => {
      downloads++;
      return tarball(WRAPPED_TB);
    }, runShell);
    await provide(WORKSPACE);
    await provide({ ...WORKSPACE, sha: "d".repeat(40) });
    expect(downloads).toBe(2);
  });

  it("hands a failed materialization through as null", async () => {
    const provide = makeTreeProvider(async () => null, runShell);
    expect(await provide(WORKSPACE)).toBe(null);
  });
});
