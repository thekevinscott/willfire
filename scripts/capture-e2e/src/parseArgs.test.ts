import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "./parseArgs.js";

describe("parseArgs", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as () => never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the flag that follows each name, wherever it sits", () => {
    expect(parseArgs(["--pr", "12", "--repo", "o/r"])).toEqual({ repo: "o/r", pr: 12 });
  });

  it("takes the PR number as a number", () => {
    expect(parseArgs(["--repo", "o/r", "--pr", "7"]).pr).toBe(7);
  });

  it.each([
    ["--repo", ["--pr", "1"]],
    ["--pr", ["--repo", "o/r"]],
  ])("exits 2 with a usage line when %s is missing", (_flag, argv) => {
    expect(() => parseArgs(argv)).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe(
      "usage: capture-e2e --repo owner/name --pr N",
    );
  });

  it("exits 2 when a flag is named with no value after it", () => {
    expect(() => parseArgs(["--repo", "o/r", "--pr"])).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
  });
});
