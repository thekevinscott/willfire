import { describe, expect, it } from "vitest";
import { DOCKERFILE, SANDBOX_NODE_MAJOR, sandboxConfig } from "./sandboxConfig.js";

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

describe("DOCKERFILE", () => {
  it("ships the node major the runtime refusal boundary names", () => {
    expect(DOCKERFILE).toContain(`FROM node:${SANDBOX_NODE_MAJOR}-slim`);
  });
});
