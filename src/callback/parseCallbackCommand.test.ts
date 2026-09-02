import { describe, expect, it } from "vitest";
import { parseCallbackCommand } from "./parseCallbackCommand.js";

describe("parseCallbackCommand", () => {
  it("splits on runs of whitespace into argv", () => {
    expect(parseCallbackCommand("npx putitoutthere resolve")).toEqual({
      ok: true,
      argv: ["npx", "putitoutthere", "resolve"],
    });
    expect(parseCallbackCommand("  node \t script.js  ")).toEqual({
      ok: true,
      argv: ["node", "script.js"],
    });
  });

  it("refuses an empty value", () => {
    expect(parseCallbackCommand("")).toEqual({ ok: false, reason: "--callback needs a command" });
    expect(parseCallbackCommand("   ")).toEqual({
      ok: false,
      reason: "--callback needs a command",
    });
  });

  it("refuses a value that leads with a dash, wherever the whitespace put it", () => {
    expect(parseCallbackCommand("--json")).toEqual({
      ok: false,
      reason: "--callback command cannot start with '-': --json",
    });
    expect(parseCallbackCommand("  -x foo")).toEqual({
      ok: false,
      reason: "--callback command cannot start with '-': -x",
    });
  });

  it("passes shell-looking text through untouched — argv, not a script", () => {
    expect(parseCallbackCommand("echo a|b")).toEqual({ ok: true, argv: ["echo", "a|b"] });
  });
});
