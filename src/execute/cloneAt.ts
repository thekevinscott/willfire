import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowSource } from "../types.js";
import type { RunCommand } from "./types.js";

export async function cloneAt(
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
