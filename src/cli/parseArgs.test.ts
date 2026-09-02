import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "./parseArgs.js";

// The isolation gate wants collaborators mocked; --action and --callback
// validation are part of parseArgs's contract, so the mocks pass the real
// guards through.
vi.mock(
  "./isPrEventAction.js",
  async () => await vi.importActual<typeof import("./isPrEventAction.js")>("./isPrEventAction.js"),
);
vi.mock(
  "../callback/parseCallbackCommand.js",
  async () =>
    await vi.importActual<typeof import("../callback/parseCallbackCommand.js")>(
      "../callback/parseCallbackCommand.js",
    ),
);

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
      callbacks: [],
    });
  });

  it("parses every flag", () => {
    expect(
      parseArgs([
        "--repo",
        "o/r",
        "--pr",
        "2",
        "--json",
        "--action",
        "synchronize",
        "--callback",
        "npx resolver",
      ]),
    ).toEqual({
      repo: "o/r",
      pr: 2,
      json: true,
      action: "synchronize",
      callbacks: ["npx resolver"],
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
    expect(() =>
      parseArgs(["--repo", "o/r", "--pr", "1", "--action", "syncronize"]),
    ).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("unknown --action: syncronize");
    expect(vi.mocked(console.error).mock.calls[1][0]).toMatch(/^usage: predict /);
  });

  it("collects every --callback value, in order", () => {
    expect(
      parseArgs([
        "--repo",
        "o/r",
        "--pr",
        "1",
        "--callback",
        "npx resolver a",
        "--callback",
        "other b",
      ]).callbacks,
    ).toEqual(["npx resolver a", "other b"]);
  });

  it("mentions --callback in the usage line", () => {
    expect(() => parseArgs([])).toThrow("exited");
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('[--callback "<command>"]...');
  });

  it("exits 2 on a --callback with a blank command", () => {
    expect(() =>
      parseArgs(["--repo", "o/r", "--pr", "1", "--callback", "  "]),
    ).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("--callback needs a command");
    expect(vi.mocked(console.error).mock.calls[1][0]).toMatch(/^usage: predict /);
  });

  it("exits 2 on a --callback with no value at all", () => {
    expect(() => parseArgs(["--repo", "o/r", "--pr", "1", "--callback"])).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe("--callback needs a command");
  });

  it("exits 2 on a --callback command that starts with a dash", () => {
    expect(() =>
      parseArgs(["--repo", "o/r", "--pr", "1", "--callback", "--json"]),
    ).toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(2);
    expect(vi.mocked(console.error).mock.calls[0][0]).toBe(
      "--callback command cannot start with '-': --json",
    );
  });
});
