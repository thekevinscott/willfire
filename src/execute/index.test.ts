import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("the execute barrel", () => {
  it("exports exactly the executor's public surface", () => {
    // Type-only exports have no runtime presence; this pins the value exports.
    expect(Object.keys(barrel).sort()).toEqual([
      "makeCloneProvider",
      "makeExecutor",
      "makeTreeProvider",
      "parseGithubOutput",
      "renderTemplate",
      "runShell",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });
});
