import { describe, expect, it, vi } from "vitest";
import type { RunSpec } from "../execute/types.js";
import { imageTag } from "./imageTag.js";
import { sandboxArgv } from "./sandboxArgv.js";
import type { SandboxConfig } from "./sandboxConfig.js";

// The isolation gate wants collaborators mocked; the argv must carry the real
// tag, so the mock passes the actual module through.
vi.mock(
  "./imageTag.js",
  async () => await vi.importActual<typeof import("./imageTag.js")>("./imageTag.js"),
);

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  script: "true",
  shell: "bash",
  cwd: "/w",
  env: {},
  ...over,
});

describe("sandboxArgv", () => {
  const cfg: SandboxConfig = { dockerBin: "docker", uid: 7, gid: 9, dockerfile: "FROM x\n" };

  it("isolates filesystem and env, keeps network, exposes exactly the named mounts and env", () => {
    const argv = sandboxArgv(
      spec({
        script: "echo hi",
        cwd: "/repo",
        env: { PATH: "/host/bin", HOME: "/home/host", FOO: "bar" },
        mounts: [
          { path: "/repo", writable: true },
          { path: "/out", writable: false },
        ],
      }),
      cfg,
      "box",
    );
    expect(argv).toEqual([
      "run",
      "--rm",
      "--name",
      "box",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--memory",
      "2g",
      "--pids-limit",
      "512",
      "--cpus",
      "2",
      "--tmpfs",
      "/tmp:size=1g",
      "--user",
      "7:9",
      "-v",
      "/repo:/repo",
      "-v",
      "/out:/out:ro",
      "-w",
      "/repo",
      // The host PATH and HOME are dropped.
      "-e",
      "FOO=bar",
      "-e",
      "HOME=/tmp",
      imageTag("FROM x\n"),
      "bash",
      "--noprofile",
      "--norc",
      "-e",
      "-o",
      "pipefail",
      "-c",
      "echo hi",
    ]);
  });

  it("mirrors runShell's sh invocation and mounts nothing unasked", () => {
    const argv = sandboxArgv(spec({ shell: "sh" }), cfg, "box");
    expect(argv).not.toContain("-v");
    expect(argv.slice(-4)).toEqual(["sh", "-e", "-c", "true"]);
  });

  it("swaps the tmpfs for the state volumes when a job's state is handed in", () => {
    const argv = sandboxArgv(spec(), cfg, "box", { usr: "vu", tmp: "vt" });
    expect(argv).not.toContain("--tmpfs");
    const flags = argv.flatMap((a, i) => (a === "-v" ? [argv[i + 1]] : []));
    expect(flags).toEqual(["vu:/usr/local", "vt:/tmp"]);
    // Still a read-only root: the volumes are the only writable rootfs paths.
    expect(argv).toContain("--read-only");
  });
});
