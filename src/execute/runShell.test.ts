// The subprocess seam is exercised for real: a faked shell would test the
// interpretation this module exists to avoid doing.

import { describe, expect, it } from "vitest";
import { runShell } from "./runShell.js";

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };

describe("runShell", () => {
  it("reports a spawn that never starts as exit 127", async () => {
    const r = await runShell({
      script: "true",
      shell: "bash",
      cwd: "/nonexistent-dir",
      env: SH_ENV,
    });
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
    // Exactly the cap: 200 51-byte lines overflow it, and the tail survives
    // truncation — the last line is the 200th.
    expect(r.stderr.length).toBe(4096);
    expect(r.stderr.trimEnd().endsWith("200")).toBe(true);
  });

  it("hands back captured stdout", async () => {
    const r = await runShell({ script: "echo spoken; exit 3", shell: "bash", cwd: TMP, env: SH_ENV });
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("spoken\n");
  });

  it("keeps only the stdout tail", async () => {
    const r = await runShell({
      script: 'for i in $(seq 1 200); do printf "%050d\\n" "$i"; done; exit 1',
      shell: "bash",
      cwd: TMP,
      env: SH_ENV,
    });
    expect(r.code).toBe(1);
    expect(r.stdout.length).toBe(4096);
    expect(r.stdout.trimEnd().endsWith("200")).toBe(true);
  });

  it("gives the script no stdin — a read sees EOF, not an open pipe", async () => {
    const r = await runShell({ script: "cat", shell: "bash", cwd: TMP, env: SH_ENV });
    expect(r.code).toBe(0);
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
