import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("sandbox barrel", () => {
  it("exposes the sandbox surface", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "DOCKERFILE",
      "SANDBOX_NODE_MAJOR",
      "imageTag",
      "makeSandboxRunner",
      "sandboxArgv",
      "sandboxConfig",
    ]);
  });
});
