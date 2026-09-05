// Real clones against real local git repos: what a clone does with a sha no
// branch reaches is the whole question, and a faked git could not answer it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCloneProvider } from "./makeCloneProvider.js";
import { runShell } from "./runShell.js";
import type { RunSpec } from "./types.js";
import type { WorkflowSource } from "../types.js";

// The isolation gate wants collaborators mocked; the real subprocess is the
// point here, so the mock passes the real module through.
vi.mock(
  "./runShell.js",
  async () => await vi.importActual<typeof import("./runShell.js")>("./runShell.js"),
);

const SHA = "c".repeat(40);

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };
let treeSeq = 0;

/** A fresh empty temp dir, made through `runShell`. */
async function tempDir(): Promise<string> {
  const root = `${TMP}/wf-clone-test-${process.pid}-${treeSeq++}`;
  const r = await runShell({
    script: 'mkdir -p "$D"',
    shell: "bash",
    cwd: TMP,
    env: { ...SH_ENV, D: root },
  });
  expect(r.code).toBe(0);
  return root;
}

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
  const repo = await tempDir();
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
      return { code: 1, stdout: "", stderr: "" };
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
      return { code: 1, stdout: "", stderr: "" };
    }, null);
    expect(await provide(sourceAt(SHA))).toBe(null);
    expect(seen).toEqual([""]);
  });
});
