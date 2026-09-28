import { describe, expect, it } from "vitest";
import { DOCKERFILE, sandboxConfig } from "./sandboxConfig.js";

describe("sandboxConfig", () => {
  it("defaults to the docker on PATH, the invoking user, and the shipped dockerfile", () => {
    const cfg = sandboxConfig();
    expect(cfg.dockerBin).toBe("docker");
    expect(cfg.uid).toBe(process.getuid!());
    expect(cfg.gid).toBe(process.getgid!());
    expect(cfg.dockerfile).toBe(DOCKERFILE);
  });

  it("ships an image whose /usr/local dirs take a non-root `npm install -g`", () => {
    expect(DOCKERFILE).toContain("find /usr/local -type d -exec chmod a+w {} +");
  });

  it("takes every override", () => {
    const cfg = sandboxConfig({ dockerBin: "/x/docker", uid: 7, gid: 9, dockerfile: "FROM x\n" });
    expect(cfg).toEqual({ dockerBin: "/x/docker", uid: 7, gid: 9, dockerfile: "FROM x\n" });
  });
});
