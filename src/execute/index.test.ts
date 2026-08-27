import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the execute barrel", () => {
  it("exports exactly the executor's public surface", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "makeExecutor",
      "makeTreeProvider",
      "parseGithubOutput",
      "parseGrant",
      "runShell",
    ]);
    expect(typeof barrel.makeExecutor).toBe("function");
  });
});
