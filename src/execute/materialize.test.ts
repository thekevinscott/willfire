import { afterEach, describe, expect, it, vi } from "vitest";
import { materialize } from "./materialize.js";
import { runShell } from "./runShell.js";
import type { WorkflowSource } from "../types.js";

vi.mock("./runShell.js", async () => {
  const actual = await vi.importActual<typeof import("./runShell.js")>("./runShell.js");
  return { ...actual };
});

const SHA = "c".repeat(40);
const SRC: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };
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
const TWO_TB = "H4sIAAAAAAAAA+3TSwqDMBSF4buUrCAPyWM9dgOCRnD5xtKJUuygxLT4f5MbSAYnHK42Up0tUgrPWRznm3OKwYsK9aOJzFPuR6VkHIZ89u7T/Z/Sptd5qfuzrdQY/Un/bt+/s7Er/duqqV5u3r9rHQBNafP4zf0P7P8VutYBAAAAAAAAAAAAAADA11aiM229ACgAAA==";
const ONE_TB = "H4sIAAAAAAAAA+3RTQqAIBCG4TmKJ7Ck1PO0j4QyqNv3s4kiCgKJ6H02M6CLb/h0JsnlM+/tOmfHebJ7Z0tRNn00kb6LVauUtCHEq3937x+ls9DUo45DwuOWUp0rL/o3+/6NKZwVlaeLtPl5/+btAAAAAAAAAAAAAAAAAAAemwDJjzcgACgAAA==";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("materialize", () => {
  it("extracts a tarball and unwraps the single wrapping directory", async () => {
    const tree = await materialize(SRC, async () => tarball(WRAPPED_TB), runShell);
    expect(tree).not.toBe(null);
    expect(await fileIs(`${tree}/file.txt`, "content")).toBe(true);
  });

  it("returns the extraction root when there is no single wrapping directory", async () => {
    const tree = await materialize(SRC, async () => tarball(TWO_TB), runShell);
    expect(await fileIs(`${tree}/a.txt`, "1")).toBe(true);
    expect(await fileIs(`${tree}/b.txt`, "2")).toBe(true);
  });

  it("does not unwrap a single top-level file", async () => {
    const tree = await materialize(SRC, async () => tarball(ONE_TB), runShell);
    expect(await fileIs(`${tree}/only.txt`, "1")).toBe(true);
  });

  it("hands a failed download through as null", async () => {
    expect(await materialize(SRC, async () => null, runShell)).toBe(null);
  });

  it("hands a failed extraction through as null", async () => {
    expect(await materialize(SRC, async () => new Uint8Array([1, 2, 3]), runShell)).toBe(null);
  });

  it("hands the extraction an empty PATH when the parent has none", async () => {
    vi.stubEnv("PATH", undefined);
    const seen: string[] = [];
    const tree = await materialize(SRC, async () => new Uint8Array([0]), async (spec) => {
      seen.push(spec.env.PATH);
      return { code: 1, stderr: "" };
    });
    expect(tree).toBe(null);
    expect(seen).toEqual([""]);
  });
});
