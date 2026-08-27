import { describe, expect, it, vi } from "vitest";
import type { RunSpec } from "../execute.js";
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

  it("isolates fully and exposes exactly the named mounts and env", () => {
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
    );
    expect(argv).toEqual([
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp",
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
    const argv = sandboxArgv(spec({ shell: "sh" }), cfg);
    expect(argv).not.toContain("-v");
    expect(argv.slice(-4)).toEqual(["sh", "-e", "-c", "true"]);
  });
});
