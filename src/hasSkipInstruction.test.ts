import { describe, expect, it } from "vitest";
import { hasSkipInstruction } from "./hasSkipInstruction.js";

describe("hasSkipInstruction", () => {
  it.each(["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]"])(
    "reads %s anywhere in the message",
    (token) => {
      expect(hasSkipInstruction(`chore: docs ${token} and more`)).toBe(true);
    },
  );

  it("reads a bracketed token case-insensitively", () => {
    expect(hasSkipInstruction("chore: docs [SKIP CI]")).toBe(true);
  });

  it("requires the brackets", () => {
    expect(hasSkipInstruction("chore: skip ci")).toBe(false);
  });

  it("reads the skip-checks trailer", () => {
    expect(hasSkipInstruction("feat: thing\n\nskip-checks: true\n")).toBe(true);
  });

  it("reads the trailer with no space after the colon", () => {
    expect(hasSkipInstruction("feat: thing\n\nskip-checks:true\n")).toBe(true);
  });

  it("reads the trailer with several spaces after the colon", () => {
    expect(hasSkipInstruction("feat: thing\n\nskip-checks:   true\n")).toBe(true);
  });

  it("reads the trailer case-insensitively", () => {
    expect(hasSkipInstruction("feat: thing\n\nSKIP-CHECKS: TRUE\n")).toBe(true);
  });

  it("requires the trailer to start its own line", () => {
    expect(hasSkipInstruction("feat: thing\n\nsee the docs on skip-checks: true\n")).toBe(false);
  });

  it("is false for a message carrying neither", () => {
    expect(hasSkipInstruction("chore: routine")).toBe(false);
  });
});
