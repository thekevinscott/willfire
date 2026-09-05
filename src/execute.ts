/**
 * The real-world dependencies the executor runs on: the runner's default
 * shells, and tree providers that materialize repos from tarballs or clones.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProvideTree, RunCommand } from "./execute/types.js";
import type { WorkflowSource } from "./types.js";

/**
 * The runner's default shell invocations, faithfully. Nothing of the parent
 * environment leaks in beyond what the spec names.
 */
export const runShell: RunCommand = (spec) =>
  new Promise((resolvePromise) => {
    const argv =
      spec.shell === "bash"
        ? ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", spec.script]
        : ["-e", "-c", spec.script];
    const child = spawn(spec.shell, argv, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += String(d);
      if (stderr.length > 4096) {
        stderr = stderr.slice(-4096);
      }
    });
    child.on("error", () => resolvePromise({ code: 127, stderr }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });

/**
 * Materialize repo trees from tarballs, one download per commit. GitHub wraps
 * the tree in a single `owner-repo-shortsha/` directory, unwrapped here.
 */
export function makeTreeProvider(
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): ProvideTree {
  const cache = new Map<string, Promise<string | null>>();
  return (source, opts) => {
    // A tarball has no history to give.
    if (opts?.history === true) {
      return Promise.resolve(null);
    }
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const p = materialize(source, download, runCommand);
    cache.set(key, p);
    return p;
  };
}

/**
 * Materialize repo trees by full clone, on the host — it needs the network
 * the sandbox denies. The token never touches the URL or persisted git
 * config, because `.git/config` later rides into the sandbox: auth travels
 * as a per-invocation `http.extraheader` and is gone when the command is.
 */
export function makeCloneProvider(
  runCommand: RunCommand,
  token: string | null,
  opts: { remoteUrl?: (source: WorkflowSource) => string } = {},
): ProvideTree {
  const remoteUrl =
    opts.remoteUrl ?? ((s: WorkflowSource) => `https://github.com/${s.owner}/${s.repo}.git`);
  const cache = new Map<string, Promise<string | null>>();
  return (source) => {
    const key = `${source.owner}/${source.repo}@${source.sha}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const p = cloneAt(source, remoteUrl(source), token, runCommand);
    cache.set(key, p);
    return p;
  };
}

async function cloneAt(
  source: WorkflowSource,
  remote: string,
  token: string | null,
  runCommand: RunCommand,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "willfire-clone-"));
  const dest = join(dir, "tree");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    // A fresh HOME and no system config: none of the invoking user's git
    // identity or credential helpers reach this clone.
    HOME: dir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    WILLFIRE_REMOTE: remote,
    WILLFIRE_DEST: dest,
    WILLFIRE_SHA: source.sha,
  };
  let auth = "";
  if (token !== null) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    env.WILLFIRE_AUTH = `http.extraheader=AUTHORIZATION: basic ${basic}`;
    auth = ' -c "$WILLFIRE_AUTH"';
  }
  // A PR head commit may live only under `refs/pull/N/head`, which a plain
  // clone does not fetch, so a failed checkout retries via a direct fetch.
  const r = await runCommand({
    script: [
      `git${auth} clone --quiet "$WILLFIRE_REMOTE" "$WILLFIRE_DEST"`,
      'cd "$WILLFIRE_DEST"',
      `git checkout --quiet --detach "$WILLFIRE_SHA" 2>/dev/null || {`,
      `  git${auth} fetch --quiet origin "$WILLFIRE_SHA"`,
      '  git checkout --quiet --detach "$WILLFIRE_SHA"',
      "}",
    ].join("\n"),
    shell: "bash",
    cwd: dir,
    env,
  });
  return r.code === 0 ? dest : null;
}

async function materialize(
  source: WorkflowSource,
  download: (source: WorkflowSource) => Promise<Uint8Array | null>,
  runCommand: RunCommand,
): Promise<string | null> {
  const bytes = await download(source);
  if (bytes === null) {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), "willfire-tree-"));
  const archive = join(dir, "tree.tar.gz");
  await writeFile(archive, bytes);
  const dest = join(dir, "tree");
  await mkdir(dest);
  const r = await runCommand({
    script: 'tar -xzf "$WILLFIRE_ARCHIVE" -C "$WILLFIRE_DEST"',
    shell: "bash",
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      WILLFIRE_ARCHIVE: archive,
      WILLFIRE_DEST: dest,
    },
  });
  if (r.code !== 0) {
    return null;
  }
  const entries = await readdir(dest);
  if (entries.length === 1) {
    const sub = join(dest, entries[0]);
    if ((await stat(sub)).isDirectory()) {
      return sub;
    }
  }
  return dest;
}
