import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTreeProvider } from "./makeTreeProvider.js";
import { runShell } from "./runShell.js";
import type { WorkflowSource } from "../types.js";

// The isolation gate wants collaborators mocked; extraction through a real
// tar is what this suite pins, so the mock passes the real module through.
vi.mock(
  "./runShell.js",
  async () => await vi.importActual<typeof import("./runShell.js")>("./runShell.js"),
);

const SHA = "c".repeat(40);

/** The PR head every provider call here asks for. */
const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };

/** True when `path` holds exactly `want` — read through `runShell`. */
async function fileIs(path: string, want: string): Promise<boolean> {
  const r = await runShell({
    script: '[ "$(cat "$F")" = "$W" ]',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, F: path, W: want },
  });
  return r.code === 0;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Real gzipped tarballs, embedded so the suite needs no filesystem of its
 * own to produce bytes. Each was made with
 * `tar --owner=0 --group=0 --mtime=@0 --sort=name -czf` over the tree its
 * name describes; extraction below runs the real `tar`.
 */
const tarball = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, "base64"));

/** `o-r-ccccccc/file.txt` = "content" — the GitHub single-wrapper shape. */
const WRAPPED_TB = "H4sIAAAAAAAAA+3S0QrCIBSA4fMovsCcw6nPE2ODICaYQY/fqqvGWAQzqP3fzRH0QvnVtRRnJiG4x5zM58I6eNeKcuWvJnI550NSSlKMee3cu/0fpetYpap7KvQXPu7fNKGx9P+G1/7D8dTrfN34ofeo3rcr/cOsv7XBiDLbXmPZzvt3ccz9+I8vAwAAAAAAAAAAAAAA2IcbvGawBgAoAAA=";
/** `a.txt` = "1", `b.txt` = "2" — two top-level entries. */
const TWO_TB = "H4sIAAAAAAAAA+3TSwqDMBSF4buUrCAPyWM9dgOCRnD5xtKJUuygxLT4f5MbSAYnHK42Up0tUgrPWRznm3OKwYsK9aOJzFPuR6VkHIZ89u7T/Z/Sptd5qfuzrdQY/Un/bt+/s7Er/duqqV5u3r9rHQBNafP4zf0P7P8VutYBAAAAAAAAAAAAAADA11aiM229ACgAAA==";
/** `only.txt` = "1" — a single top-level *file*, not a directory. */
const ONE_TB = "H4sIAAAAAAAAA+3RTQqAIBCG4TmKJ7Ck1PO0j4QyqNv3s4kiCgKJ6H02M6CLb/h0JsnlM+/tOmfHebJ7Z0tRNn00kb6LVauUtCHEq3937x+ls9DUo45DwuOWUp0rL/o3+/6NKZwVlaeLtPl5/+btAAAAAAAAAAAAAAAAAAAemwDJjzcgACgAAA==";
/** `d1/a.txt` = "1", `d2/b.txt` = "2" — two top-level directories. */
const TWO_DIRS_TB = "H4sIAAAAAAAAA+3UQQqDMBCF4RwlJ6iZaMx5LNkLNoUev6PQjQW7aYzi/20mkCwmPHhJGlOaUzGGZar1/D6Lc741NhTfTD0feZisNdM45q13v+5PKkkz3PKr6NfmUPu+28hf1vnHqPm7kkt9XDx/qb0Aqkr+oP3f0f970Pzvh+z/QP/vwddeAAAAAAAAAAAAAADwF29Gl9pOACgAAA==";

describe("makeTreeProvider", () => {
  it("downloads once per commit and unwraps the single wrapping directory", async () => {
    // GitHub tarballs wrap the tree in one `owner-repo-shortsha/` directory.
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

  it("returns the extraction root when there is no single wrapping directory", async () => {
    const provide = makeTreeProvider(async () => tarball(TWO_TB), runShell);
    const tree = await provide(WORKSPACE);
    expect(await fileIs(`${tree}/a.txt`, "1")).toBe(true);
  });

  it("does not unwrap a single top-level file", async () => {
    const provide = makeTreeProvider(async () => tarball(ONE_TB), runShell);
    const tree = await provide(WORKSPACE);
    expect(await fileIs(`${tree}/only.txt`, "1")).toBe(true);
  });

  it("keeps two top-level directories side by side", async () => {
    // Descending into either directory would orphan the other, whichever
    // order readdir yields them in.
    const provide = makeTreeProvider(async () => tarball(TWO_DIRS_TB), runShell);
    const tree = await provide(WORKSPACE);
    expect(await fileIs(`${tree}/d1/a.txt`, "1")).toBe(true);
    expect(await fileIs(`${tree}/d2/b.txt`, "2")).toBe(true);
  });

  it("hands a failed download through as null", async () => {
    const provide = makeTreeProvider(async () => null, runShell);
    expect(await provide(WORKSPACE)).toBe(null);
  });

  it("hands the extraction an empty PATH when the parent has none", async () => {
    vi.stubEnv("PATH", undefined);
    const seen: string[] = [];
    const provide = makeTreeProvider(
      async () => new Uint8Array([0]),
      async (spec) => {
        seen.push(spec.env.PATH);
        return { code: 1, stderr: "" };
      },
    );
    expect(await provide(WORKSPACE)).toBe(null);
    expect(seen).toEqual([""]);
  });

  it("hands a failed extraction through as null", async () => {
    const provide = makeTreeProvider(async () => new Uint8Array([1, 2, 3]), runShell);
    expect(await provide(WORKSPACE)).toBe(null);
  });

  it("declines a history request rather than serving a shallow tree as deep", async () => {
    const provide = makeTreeProvider(async () => tarball(WRAPPED_TB), runShell);
    expect(await provide(WORKSPACE, { history: true })).toBe(null);
  });
});
