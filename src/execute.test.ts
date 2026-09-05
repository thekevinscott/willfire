// Unit suite for the real-world deps: the runner's shells and the two tree
// providers. The subprocess seam is exercised for real — a faked shell would
// test the interpretation this module exists to avoid doing — and fixture
// trees are built through `runShell` itself, so the module under test is the
// only thing the suite touches the filesystem with.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCloneProvider, makeTreeProvider, runShell } from "./execute.js";
import type { RunSpec } from "./execute/types.js";
import type { WorkflowSource } from "./types.js";

const SHA = "c".repeat(40);

/** The PR head every materialization here is keyed on. */
const WORKSPACE: WorkflowSource = { owner: "o", repo: "r", ref: SHA, sha: SHA };

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };
let treeSeq = 0;

/** Write a file tree under a fresh temp dir and return its root. */
async function tempTree(files: Record<string, string>): Promise<string> {
  const root = `${TMP}/wf-exec-test-${process.pid}-${treeSeq++}`;
  const r0 = await runShell({
    script: 'mkdir -p "$D"',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, D: root },
  });
  expect(r0.code).toBe(0);
  for (const [rel, content] of Object.entries(files)) {
    const r = await runShell({
      script: 'mkdir -p "$(dirname "$F")" && printf %s "$C" > "$F"',
      shell: "bash",
      cwd: TMP,
      env: { ...SH_ENV, F: `${root}/${rel}`, C: content },
    });
    expect(r.code).toBe(0);
  }
  return root;
}

/** True when `path` holds exactly `want` — read through `runShell`, again. */
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

// ------------------------------------------------------------------ runShell

describe("runShell", () => {
  it("reports a spawn that never starts as exit 127", async () => {
    const r = await runShell({ script: "true", shell: "bash", cwd: "/nonexistent-dir", env: SH_ENV });
    expect(r.code).toBe(127);
  });

  it("keeps only the stderr tail", async () => {
    const r = await runShell({
      script: 'for i in $(seq 1 200); do printf "%050d\\n" "$i" >&2; done; exit 1',
      shell: "bash",
      cwd: TMP,
      env: SH_ENV,
    });
    expect(r.code).toBe(1);
    expect(r.stderr.length).toBeLessThanOrEqual(4096);
    // The tail survives truncation — the last line is the 200th.
    expect(r.stderr.trimEnd().endsWith("200")).toBe(true);
  });

  it("reports a signal death as exit 1", async () => {
    const r = await runShell({ script: 'kill -9 "$$"', shell: "bash", cwd: TMP, env: SH_ENV });
    expect(r.code).toBe(1);
  });

  it("ignores mounts — the host has nothing to bind", async () => {
    const r = await runShell({
      script: "true",
      shell: "bash",
      cwd: TMP,
      env: SH_ENV,
      mounts: [{ path: "/nonexistent-mount-path", writable: false }],
    });
    expect(r.code).toBe(0);
  });

  it("runs a sh script under a plain -e, with no bash-only options", async () => {
    const r = await runShell({
      script: "false; true",
      shell: "sh",
      cwd: TMP,
      env: SH_ENV,
    });
    expect(r.code).toBe(1);
  });
});

// ----------------------------------------------------------- makeTreeProvider

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

// ---------------------------------------------------------- makeCloneProvider

/** Read a small file back through `runShell` — stderr is the return channel. */
async function readVia(path: string): Promise<string> {
  const r = await runShell({
    script: 'cat "$F" >&2',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, F: path },
  });
  expect(r.code).toBe(0);
  return r.stderr.trim();
}

/**
 * A real repo with two commits: `main` at "one", and "two" parked under
 * `refs/pull/1/head` the way GitHub parks PR heads — reachable from no branch.
 */
async function gitFixture(): Promise<{ repo: string; main: string; parked: string }> {
  const repo = await tempTree({});
  const r = await runShell({
    script: [
      'git -C "$R" init -q -b main',
      'printf a > "$R/f.txt"',
      'git -C "$R" add f.txt',
      'git -C "$R" commit -qm one',
      'git -C "$R" rev-parse HEAD > "$R/.main-sha"',
      'printf b > "$R/f.txt"',
      'git -C "$R" commit -aqm two',
      'git -C "$R" update-ref refs/pull/1/head HEAD',
      'git -C "$R" rev-parse HEAD > "$R/.parked-sha"',
      'git -C "$R" reset -q --hard "$(cat "$R/.main-sha")"',
      'git -C "$R" config uploadpack.allowAnySHA1InWant true',
    ].join("\n"),
    shell: "bash",
    cwd: TMP,
    env: {
      ...SH_ENV,
      R: repo,
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  expect([r.code, r.stderr]).toEqual([0, ""]);
  return {
    repo,
    main: await readVia(`${repo}/.main-sha`),
    parked: await readVia(`${repo}/.parked-sha`),
  };
}

describe("makeCloneProvider", () => {
  const sourceAt = (sha: string): WorkflowSource => ({ owner: "o", repo: "r", ref: sha, sha });

  it("clones once per commit and detaches at a sha a branch reaches", async () => {
    const { repo, main } = await gitFixture();
    const provide = makeCloneProvider(runShell, null, { remoteUrl: () => `file://${repo}` });
    const tree = await provide(sourceAt(main), { history: true });
    expect(tree).not.toBe(null);
    expect(await fileIs(`${tree}/f.txt`, "a")).toBe(true);
    expect(await provide(sourceAt(main))).toBe(tree);
  });

  it("falls back to fetching a sha parked under refs/pull", async () => {
    const { repo, parked } = await gitFixture();
    const provide = makeCloneProvider(runShell, null, { remoteUrl: () => `file://${repo}` });
    const tree = await provide(sourceAt(parked));
    expect(tree).not.toBe(null);
    expect(await fileIs(`${tree}/f.txt`, "b")).toBe(true);
  });

  it("yields null for a sha the remote does not have", async () => {
    const { repo } = await gitFixture();
    const provide = makeCloneProvider(runShell, null, { remoteUrl: () => `file://${repo}` });
    expect(await provide(sourceAt("e".repeat(40)))).toBe(null);
  });

  it("passes auth as an ephemeral header env var, never in the remote URL", async () => {
    const specs: RunSpec[] = [];
    const provide = makeCloneProvider(async (spec) => {
      specs.push(spec);
      return { code: 1, stderr: "" };
    }, "tok-123");
    expect(await provide(sourceAt(SHA))).toBe(null);
    const [spec] = specs;
    // The default remote is GitHub's, with no credentials in it.
    expect(spec.env.WILLFIRE_REMOTE).toBe("https://github.com/o/r.git");
    const basic = Buffer.from("x-access-token:tok-123").toString("base64");
    expect(spec.env.WILLFIRE_AUTH).toBe(`http.extraheader=AUTHORIZATION: basic ${basic}`);
    expect(spec.script).toContain('-c "$WILLFIRE_AUTH"');
    expect(spec.script).not.toContain("tok-123");
    // A fresh HOME, no prompts, no system config: the invoking user's git
    // identity and credential helpers never reach the clone.
    expect(spec.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(spec.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(spec.env.HOME).not.toBe(process.env.HOME);
  });

  it("hands the clone an empty PATH when the parent has none", async () => {
    vi.stubEnv("PATH", undefined);
    const seen: string[] = [];
    const provide = makeCloneProvider(async (spec) => {
      seen.push(spec.env.PATH);
      return { code: 1, stderr: "" };
    }, null);
    expect(await provide(sourceAt(SHA))).toBe(null);
    expect(seen).toEqual([""]);
  });
});
