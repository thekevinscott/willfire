import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("sandbox barrel", () => {
  it("exposes exactly the sandbox surface", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "DOCKERFILE",
      "SANDBOX_NODE_MAJOR",
      "imageTag",
      "makeSandboxRunner",
      "sandboxArgv",
      "sandboxConfig",
    ]);
    expect(typeof barrel.DOCKERFILE).toBe("string");
    expect(typeof barrel.SANDBOX_NODE_MAJOR).toBe("number");
    expect(typeof barrel.imageTag).toBe("function");
    expect(typeof barrel.makeSandboxRunner).toBe("function");
    expect(typeof barrel.sandboxArgv).toBe("function");
    expect(typeof barrel.sandboxConfig).toBe("function");
  });
});
