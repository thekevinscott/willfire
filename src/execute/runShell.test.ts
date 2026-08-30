import { describe, expect, it } from "vitest";
import { runShell } from "./runShell.js";

const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");
const SH_ENV = { PATH: process.env.PATH ?? "" };

describe("runShell", () => {
  it("reports a spawn that never starts as exit 127", async () => {
    const r = await runShell({ script: "true", shell: "bash", cwd: "/nonexistent-dir", env: SH_ENV });
    expect(r.code).toBe(127);
  });

  it("keeps only the stderr tail", async () => {
    // 100 lines of 50 characters: 5000 in, more than the cap and less than
    // twice it, so the kept tail is exactly the last 4096 whatever the chunking.
    const r = await runShell({
      script: 'for i in $(seq 1 100); do printf "%049d\\n" "$i" >&2; done; exit 1',
      shell: "bash",
      cwd: TMP,
      env: SH_ENV,
    });
    expect(r.code).toBe(1);
    expect(r.stderr.length).toBe(4096);
    // The tail survives truncation — the last line is the 100th.
    expect(r.stderr.trimEnd().endsWith("100")).toBe(true);
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
});
