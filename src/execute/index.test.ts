import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";

describe("execute barrel", () => {
  it("exports exactly the execution surface", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "makeCloneProvider",
      "makeExecutor",
      "makeTreeProvider",
      "parseGithubOutput",
      "renderTemplate",
      "runShell",
    ]);
  });
});
