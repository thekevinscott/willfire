import { spawn } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSpec } from "./execute.js";
import {
  DOCKERFILE,
  imageTag,
  makeSandboxRunner,
  sandboxArgv,
  sandboxConfig,
} from "./sandbox.js";

// Nothing here talks to real docker: `spawn` is mocked with one scripted
// child per invocation (`h.script` says how it behaves, `h.calls` records it).

interface DockerCall {
  bin: string;
  argv: string[];
  stdin: string;
}

interface Behavior {
  stderr?: string[];
  /** Exit code; `null` is a signal death. Omitted means 0. */
  close?: number | null;
  /** Fire the spawn-failure path (no binary) instead of running. */
  error?: true;
}

const h = vi.hoisted(() => ({
  calls: [] as { bin: string; argv: string[]; stdin: string }[],
  script: [] as { stderr?: string[]; close?: number | null; error?: true }[],
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const fakeSpawn = vi.fn((bin: string, argv: string[]) => {
    const behavior: Behavior = h.script.shift() ?? {};
    const call: DockerCall = { bin, argv, stdin: "" };
    h.calls.push(call);
    const handlers = new Map<string, (arg?: unknown) => void>();
    const child = {
      stderr: { on: (ev: string, cb: (d: unknown) => void) => handlers.set(`stderr:${ev}`, cb) },
      stdin: {
        write: (d: string) => {
          call.stdin += d;
        },
        end: () => {},
      },
      on: (ev: string, cb: (arg?: unknown) => void) => handlers.set(ev, cb),
    };
    // After the synchronous return, so every handler is registered first.
    queueMicrotask(() => {
      if (behavior.error) {
        handlers.get("error")?.(new Error("spawn ENOENT"));
        return;
      }
      handlers.get("spawn")?.();
      for (const chunk of behavior.stderr ?? []) handlers.get("stderr:data")?.(chunk);
      handlers.get("close")?.(behavior.close === undefined ? 0 : behavior.close);
    });
    return child as unknown as ReturnType<typeof actual.spawn>;
  });
  return { ...actual, spawn: fakeSpawn as unknown as typeof actual.spawn };
});

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  script: "true",
  shell: "bash",
  cwd: "/w",
  env: {},
  ...over,
});

const kinds = (): string[] => h.calls.map((c) => c.argv[0]);

beforeEach(() => {
  h.calls.length = 0;
  h.script.length = 0;
  vi.mocked(spawn).mockClear();
});

describe("sandboxConfig", () => {
  it("defaults to the docker on PATH, the invoking user, and the shipped dockerfile", () => {
    const cfg = sandboxConfig();
    expect(cfg.dockerBin).toBe("docker");
    expect(cfg.uid).toBe(process.getuid!());
    expect(cfg.gid).toBe(process.getgid!());
    expect(cfg.dockerfile).toBe(DOCKERFILE);
  });

  it("takes every override", () => {
    const cfg = sandboxConfig({ dockerBin: "/x/docker", uid: 7, gid: 9, dockerfile: "FROM x\n" });
    expect(cfg).toEqual({ dockerBin: "/x/docker", uid: 7, gid: 9, dockerfile: "FROM x\n" });
  });
});

describe("imageTag", () => {
  it("is a function of the dockerfile alone", () => {
    expect(imageTag("FROM x\n")).toBe(imageTag("FROM x\n"));
    expect(imageTag("FROM x\n")).not.toBe(imageTag("FROM y\n"));
    expect(imageTag(DOCKERFILE)).toMatch(/^willfire-sandbox:[0-9a-f]{12}$/);
  });
});

describe("sandboxArgv", () => {
  const cfg = sandboxConfig({ dockerBin: "docker", uid: 7, gid: 9, dockerfile: "FROM x\n" });

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

describe("makeSandboxRunner", () => {
  it("touches nothing until a spec runs", () => {
    expect(typeof makeSandboxRunner()).toBe("function");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("provisions on first use — inspect, miss, build from the inline dockerfile — then runs", async () => {
    h.script = [{ close: 1 }, {}, {}];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    const r = await run(spec({ env: { FOO: "bar" } }));
    expect(r.code).toBe(0);
    const tag = imageTag("FROM x\n");
    expect(h.calls.map((c) => c.bin)).toEqual(["dkr", "dkr", "dkr"]);
    expect(h.calls[0].argv).toEqual(["image", "inspect", tag]);
    expect(h.calls[1].argv).toEqual(["build", "-t", tag, "-"]);
    expect(h.calls[1].stdin).toBe("FROM x\n");
    expect(h.calls[0].stdin).toBe("");
    expect(h.calls[2].argv).toEqual(
      sandboxArgv(spec({ env: { FOO: "bar" } }), sandboxConfig({ dockerfile: "FROM x\n" })),
    );
  });

  it("provisions once, however many specs run", async () => {
    h.script = [{ close: 1 }, {}, {}, {}];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    await run(spec());
    await run(spec());
    expect(kinds()).toEqual(["image", "build", "run", "run"]);
  });

  it("skips the build when the image already exists", async () => {
    h.script = [{ close: 0 }, {}];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    await run(spec());
    expect(kinds()).toEqual(["image", "run"]);
  });

  it("reports a failed build as 125 with the reason, and never runs the spec", async () => {
    h.script = [{ close: 1 }, { close: 1, stderr: ["step 1/1\n", "stub build broke\n"] }];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(125);
    expect(r.stderr).toContain("cannot build sandbox image");
    expect(r.stderr).toContain("stub build broke");
    // The failure is remembered: no retry for the next spec.
    expect((await run(spec())).code).toBe(125);
    expect(kinds()).toEqual(["image", "build"]);
  });

  it("reports a missing docker binary as a provisioning failure", async () => {
    h.script = [{ error: true }, { error: true }];
    const run = makeSandboxRunner({ dockerBin: "/nonexistent/docker", dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(125);
    expect(r.stderr).toBe(`cannot build sandbox image ${imageTag("FROM x\n")}`);
  });

  it("hands back the container's exit code and stderr tail", async () => {
    h.script = [{ close: 0 }, { close: 7, stderr: ["boom\n"] }];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(7);
    expect(r.stderr).toContain("boom");
  });

  it("reports a signal death as exit 1", async () => {
    h.script = [{ close: 0 }, { close: null }];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    expect((await run(spec())).code).toBe(1);
  });

  it("caps captured stderr at its tail", async () => {
    h.script = [{ close: 0 }, { close: 0, stderr: [`${"x".repeat(5000)}END\n`] }];
    const run = makeSandboxRunner({ dockerBin: "dkr", dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.stderr.length).toBeLessThanOrEqual(4096);
    expect(r.stderr).toContain("END");
  });
});
