import { describe, expect, it, vi } from "vitest";
import type { GithubClient } from "./makeGithubClient.js";
import { predict } from "./predict.js";
import { willfire } from "../willfire.js";

vi.mock("../willfire.js", async () => {
  const actual = await vi.importActual<typeof import("../willfire.js")>("../willfire.js");
  return { ...actual, willfire: vi.fn(async () => "prediction") };
});

describe("predict", () => {
  it("forwards every argument to willfire", async () => {
    const github = {} as GithubClient;
    const opts = { action: "opened" as const };

    await expect(predict(github, "o/r", 7, opts)).resolves.toBe("prediction");
    expect(willfire).toHaveBeenCalledWith(github, "o/r", 7, opts);
  });

  it("defaults opts to an empty object", async () => {
    await predict({} as GithubClient, "o/r", 7);

    expect(willfire).toHaveBeenLastCalledWith(expect.anything(), "o/r", 7, {});
  });
});
