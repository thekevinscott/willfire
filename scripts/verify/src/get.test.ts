import { afterEach, describe, expect, it } from "vitest";
import { get } from "./get.js";

describe("get", () => {
  const argv = process.argv;

  afterEach(() => {
    process.argv = argv;
  });

  it("returns the value following the flag", () => {
    process.argv = ["node", "script", "--repo", "o/r", "--pr", "7"];
    expect(get("--repo")).toBe("o/r");
    expect(get("--pr")).toBe("7");
  });

  it("returns undefined when the flag is absent", () => {
    process.argv = ["node", "script", "--repo", "o/r"];
    expect(get("--pr")).toBeUndefined();
  });
});
