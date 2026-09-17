// Real subprocesses: this module is the spawn seam itself, so a faked spawn
// would test the fake.

import { describe, expect, it } from "vitest";
import { spawnCollect, type Collected } from "./spawnCollect.js";

const ENV = { PATH: process.env.PATH ?? "" };
const TMP = (process.env.TMPDIR ?? "/tmp").replace(/\/$/, "");

const ran = (r: Collected): { code: number; stdout: string; stderr: string } => {
  if ("failed" in r) {
    throw new Error(`expected the child to start, got: ${r.failed}`);
  }
  return r;
};

describe("spawnCollect", () => {
  it("hands back the exit code and both streams", async () => {
    const r = await spawnCollect("bash", ["-c", "echo out; echo err >&2; exit 3"], { env: ENV });
    expect(ran(r)).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  it("gives the reason a child never started", async () => {
    const r = await spawnCollect("/nonexistent/bin", ["info"], { env: ENV });
    expect("failed" in r && r.failed).toContain("ENOENT");
  });

  it("reports a close carrying no exit code as exit 1 — a signal death", async () => {
    const r = await spawnCollect("bash", ["-c", 'kill -9 "$$"'], { env: ENV });
    expect(ran(r).code).toBe(1);
  });

  it("keeps only the stderr tail", async () => {
    const r = await spawnCollect("bash", ["-c", 'printf "%05000d" 0 >&2; echo END >&2'], {
      env: ENV,
    });
    // Exactly the cap: the stream is over 4096, so the tail is all of it.
    expect(ran(r).stderr.length).toBe(4096);
    expect(ran(r).stderr).toContain("END");
  });

  it("keeps only the stdout tail", async () => {
    const r = await spawnCollect("bash", ["-c", 'printf "%05000d" 0; echo END'], { env: ENV });
    expect(ran(r).stdout.length).toBe(4096);
    expect(ran(r).stdout).toContain("END");
  });

  it("keeps stdout whole for a caller that parses it", async () => {
    const r = await spawnCollect("bash", ["-c", 'printf "%05000d" 0; echo END'], {
      env: ENV,
      wholeStdout: true,
    });
    expect(ran(r).stdout.length).toBe(5004);
  });

  it("caps stderr even when stdout is kept whole", async () => {
    const r = await spawnCollect("bash", ["-c", 'printf "%05000d" 0 >&2'], {
      env: ENV,
      wholeStdout: true,
    });
    expect(ran(r).stderr.length).toBe(4096);
  });

  it("assembles a stream across chunks", async () => {
    const r = await spawnCollect("bash", ["-c", 'printf a; sleep 0.05; printf b'], { env: ENV });
    expect(ran(r).stdout).toBe("ab");
  });

  it("runs in the directory it is given", async () => {
    const r = await spawnCollect("bash", ["-c", "pwd"], { env: ENV, cwd: TMP });
    expect(ran(r).stdout.trim()).toBe(TMP);
  });

  it("gives the child no stdin by default — a read sees EOF, not an open pipe", async () => {
    const r = await spawnCollect("bash", ["-c", "cat"], { env: ENV });
    expect(ran(r).code).toBe(0);
  });

  it("pipes stdin to the child when given, then closes it", async () => {
    const r = await spawnCollect("bash", ["-c", "cat"], { env: ENV, stdin: "from-stdin" });
    expect(ran(r).stdout).toBe("from-stdin");
  });

  it("hands the child only the env it names", async () => {
    const r = await spawnCollect("bash", ["-c", "echo ${SEEN-unset}"], {
      env: { ...ENV, SEEN: "yes" },
    });
    expect(ran(r).stdout).toBe("yes\n");
  });
});
