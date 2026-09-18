// The subprocess seam is exercised for real: a faked shell would test the
// interpretation this module exists to avoid doing. Stream capture, stdin and
// signal handling belong to `spawnCollect` and are pinned there.

import { describe, expect, it } from "vitest";
import { runShell } from "./runShell.js";

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };

describe("runShell", () => {
  it("reports a spawn that never starts as exit 127, with nothing said", async () => {
    const r = await runShell({
      script: "true",
      shell: "bash",
      cwd: "/nonexistent-dir",
      env: SH_ENV,
    });
    expect(r).toEqual({ code: 127, stdout: "", stderr: "" });
  });

  it("runs a bash script under pipefail — a failure mid-pipe is the exit code", async () => {
    const r = await runShell({ script: "false | true", shell: "bash", cwd: TMP, env: SH_ENV });
    expect(r.code).toBe(1);
  });

  it("runs a sh script under a plain -e, with no bash-only options", async () => {
    const r = await runShell({ script: "false | true", shell: "sh", cwd: TMP, env: SH_ENV });
    expect(r.code).toBe(0);
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

  it("hands back what the script said", async () => {
    const r = await runShell({ script: "echo spoken; exit 3", shell: "bash", cwd: TMP, env: SH_ENV });
    expect(r).toEqual({ code: 3, stdout: "spoken\n", stderr: "" });
  });
});
