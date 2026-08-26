import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunSpec } from "./execute.js";
import {
  DOCKERFILE,
  imageTag,
  makeSandboxRunner,
  sandboxArgv,
  sandboxConfig,
} from "./sandbox.js";

/**
 * Nothing here talks to real docker. The pure pieces — config resolution, the
 * tag, the argv — are asserted as data, and the runner is driven against a
 * stub `docker` script that records every invocation to a log and fakes
 * `image inspect` / `build` / `run` with files in its directory. What the
 * stub's log shows *is* what a real daemon would have been asked to do.
 */

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  script: "true",
  shell: "bash",
  cwd: "/w",
  env: {},
  ...over,
});

/** A fake docker binary in a fresh directory; returns both paths. */
async function stubDocker(): Promise<{ bin: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "willfire-stub-"));
  const bin = join(dir, "docker");
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/log"
case "$1" in
  image)
    if test -f "${dir}/image-exists"; then exit 0; else exit 1; fi
    ;;
  build)
    cat > "${dir}/dockerfile-received"
    if test -f "${dir}/fail-build"; then
      echo "stub build broke" >&2
      exit 1
    fi
    touch "${dir}/image-exists"
    ;;
  run)
    if test -f "${dir}/run-signal"; then kill -9 "$$"; fi
    if test -f "${dir}/run-stderr"; then cat "${dir}/run-stderr" >&2; fi
    if test -f "${dir}/run-exit"; then exit "$(cat "${dir}/run-exit")"; fi
    ;;
esac
`;
  await writeFile(bin, script);
  await chmod(bin, 0o755);
  return { bin, dir };
}

const logLines = async (dir: string): Promise<string[]> =>
  (await readFile(join(dir, "log"), "utf8")).trim().split("\n");

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
      // The host PATH and HOME are dropped: the image's PATH applies, and
      // HOME points at the tmpfs so a step may write there.
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
    // Safe with real defaults precisely because provisioning is lazy.
    expect(typeof makeSandboxRunner()).toBe("function");
  });

  it("provisions on first use — inspect, miss, build from the inline dockerfile — then runs", async () => {
    const { bin, dir } = await stubDocker();
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    const r = await run(spec({ env: { FOO: "bar" } }));
    expect(r.code).toBe(0);
    expect(await readFile(join(dir, "dockerfile-received"), "utf8")).toBe("FROM x\n");
    const lines = await logLines(dir);
    const tag = imageTag("FROM x\n");
    expect(lines[0]).toBe(`image inspect ${tag}`);
    expect(lines[1]).toBe(`build -t ${tag} -`);
    expect(lines[2]).toContain(`${tag} bash`);
    expect(lines[2]).toContain("-e FOO=bar");
  });

  it("provisions once, however many specs run", async () => {
    const { bin, dir } = await stubDocker();
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    await run(spec());
    await run(spec());
    const kinds = (await logLines(dir)).map((l) => l.split(" ")[0]);
    expect(kinds).toEqual(["image", "build", "run", "run"]);
  });

  it("skips the build when the image already exists", async () => {
    const { bin, dir } = await stubDocker();
    await writeFile(join(dir, "image-exists"), "");
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    await run(spec());
    const kinds = (await logLines(dir)).map((l) => l.split(" ")[0]);
    expect(kinds).toEqual(["image", "run"]);
  });

  it("reports a failed build as 125 with the reason, and never runs the spec", async () => {
    const { bin, dir } = await stubDocker();
    await writeFile(join(dir, "fail-build"), "");
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(125);
    expect(r.stderr).toContain("cannot build sandbox image");
    expect(r.stderr).toContain("stub build broke");
    // The failure is remembered: the next spec fails the same way without
    // retrying a build that already failed.
    expect((await run(spec())).code).toBe(125);
    const kinds = (await logLines(dir)).map((l) => l.split(" ")[0]);
    expect(kinds).toEqual(["image", "build"]);
  });

  it("reports a missing docker binary as a provisioning failure", async () => {
    const run = makeSandboxRunner({ dockerBin: "/nonexistent/docker", dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(125);
    expect(r.stderr).toBe(`cannot build sandbox image ${imageTag("FROM x\n")}`);
  });

  it("hands back the container's exit code and stderr tail", async () => {
    const { bin, dir } = await stubDocker();
    await writeFile(join(dir, "image-exists"), "");
    await writeFile(join(dir, "run-exit"), "7");
    await writeFile(join(dir, "run-stderr"), "boom\n");
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.code).toBe(7);
    expect(r.stderr).toContain("boom");
  });

  it("reports a signal death as exit 1", async () => {
    const { bin, dir } = await stubDocker();
    await writeFile(join(dir, "image-exists"), "");
    await writeFile(join(dir, "run-signal"), "");
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    expect((await run(spec())).code).toBe(1);
  });

  it("caps captured stderr at its tail", async () => {
    const { bin, dir } = await stubDocker();
    await writeFile(join(dir, "image-exists"), "");
    await writeFile(join(dir, "run-stderr"), `${"x".repeat(5000)}END\n`);
    const run = makeSandboxRunner({ dockerBin: bin, dockerfile: "FROM x\n" });
    const r = await run(spec());
    expect(r.stderr.length).toBeLessThanOrEqual(4096);
    expect(r.stderr).toContain("END");
  });
});
