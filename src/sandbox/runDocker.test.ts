// Real subprocesses, no docker: `runDocker` is a plain spawn wrapper, so bash
// stands in for the docker client. Stream capture, stdin and signal handling
// belong to `spawnCollect` and are pinned there.

import { describe, expect, it } from "vitest";
import { runDocker } from "./runDocker.js";

describe("runDocker", () => {
  it("hands back the exit code and both streams", async () => {
    const r = await runDocker("bash", ["-c", "echo spoken; echo boom >&2; exit 3"]);
    expect(r).toEqual({ code: 3, stdout: "spoken\n", stderr: "boom\n" });
  });

  it("reports a binary that cannot spawn as exit 127, with nothing said", async () => {
    const r = await runDocker("/nonexistent/docker", ["info"]);
    expect(r).toEqual({ code: 127, stdout: "", stderr: "" });
  });

  it("forwards its third argument as the child's stdin", async () => {
    const r = await runDocker("bash", ["-c", "cat >&2"], "from-stdin");
    expect(r.stderr).toBe("from-stdin");
  });

  it("runs the client with the host environment, so it can find the daemon", async () => {
    const r = await runDocker("bash", ["-c", "echo ${PATH:+found}"]);
    expect(r.stdout).toBe("found\n");
  });
});
