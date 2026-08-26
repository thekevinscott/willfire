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

  it("parses the minimal invocation", () => {
    expect(parseArgs(["--repo", "o/r", "--pr", "1"])).toEqual({
      repo: "o/r",
      pr: 1,
      json: false,
      action: undefined,
    });
  });

  it("parses every flag", () => {
    expect(
      parseArgs(["--repo", "o/r", "--pr", "2", "--json", "--action", "synchronize"]),
    ).toEqual({
      repo: "o/r",
      pr: 2,
      json: true,
      action: "synchronize",
    });
  });

  it("accepts --action reopened", () => {
    expect(parseArgs(["--repo", "o/r", "--pr", "3", "--action", "reopened"]).action).toBe(
      "reopened",
    );
  });

  it("exits 2 with a usage line when --repo or --pr is missing", () => {
    expect(() => parseArgs(["--pr", "1"])).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/^usage: predict /);
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(
      "--action opened|synchronize|reopened",
    );
  });

  it("exits 2 on an --action it does not recognise", () => {
    // Refused, not ignored: falling back to the guess would turn a typo into a
    // wrong prediction, which is the failure the flag exists to remove.
    expect(() =>
      parseArgs(["--repo", "o/r", "--pr", "1", "--action", "syncronize"]),
    ).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("unknown --action: syncronize");
    expect(vi.mocked(console.error).mock.calls[1][0]).toMatch(/^usage: predict /);
  });

});
