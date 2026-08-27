// Real subprocesses, no docker: `runDocker` is a plain spawn wrapper, so bash
// stands in for the docker client and exercises every exit path for real.

import { describe, expect, it } from "vitest";
import { runDocker } from "./runDocker.js";

describe("runDocker", () => {
  it("hands back the exit code and captured stderr", async () => {
    const r = await runDocker("bash", ["-c", "echo boom >&2; exit 3"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("boom\n");
  });

  it("pipes stdin to the child when given", async () => {
    const r = await runDocker("bash", ["-c", "cat >&2"], "from-stdin");
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("from-stdin");
  });

  it("reports a binary that cannot spawn as exit 127", async () => {
    const r = await runDocker("/nonexistent/docker", ["info"]);
    expect(r.code).toBe(127);
  });

  it("reports a signal death as exit 1", async () => {
    const r = await runDocker("bash", ["-c", 'kill -9 "$$"']);
    expect(r.code).toBe(1);
  });

  it("caps captured stderr at its tail", async () => {
    const r = await runDocker("bash", ["-c", 'printf "%05000d" 0 >&2; echo END >&2']);
    expect(r.stderr.length).toBeLessThanOrEqual(4096);
    expect(r.stderr).toContain("END");
  });
});
