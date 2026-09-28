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

  // Scratch probe willfire#394: `[skip ci]` mid-line in the body, not the
  // subject, and GitHub created no pull_request run at 0a7b9b4b.
  it("reads a bracketed token mid-line in the body", () => {
    expect(hasSkipInstruction("chore: probe h\n\nSome body [skip ci] embedded.")).toBe(true);
  });

  it("requires the brackets", () => {
    expect(hasSkipInstruction("chore: skip ci")).toBe(false);
  });

  it("reads the skip-checks trailer", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nskip-checks: true")).toBe(true);
  });

  it("reads the trailer with no space after the colon", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nskip-checks:true")).toBe(true);
  });

  it("reads the trailer with several spaces after the colon", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nskip-checks:   true")).toBe(true);
  });

  it("reads the trailer case-insensitively", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nSKIP-CHECKS: TRUE")).toBe(true);
  });

  it("requires the trailer to start its own line", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nsee the docs on skip-checks: true")).toBe(false);
  });

  // Scratch probe willfire#391: head message `chore: probe f\n\nskip-checks: true`
  // dispatched runs 36431199736 and 36431199457.
  it("declines the trailer after only one empty line", () => {
    expect(hasSkipInstruction("feat: thing\n\nskip-checks: true")).toBe(false);
  });

  // Scratch probe willfire#392: two empty lines but prose after the trailer
  // dispatched runs 36431216647 and 36431216583.
  it("declines the trailer when prose follows it", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nskip-checks: true\n\nand then more")).toBe(false);
  });

  it("allows trailing whitespace after the trailer", () => {
    expect(hasSkipInstruction("feat: thing\n\n\nskip-checks: true\n")).toBe(true);
  });

  it("is false for a message carrying neither", () => {
    expect(hasSkipInstruction("chore: routine")).toBe(false);
  });
});
