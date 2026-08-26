import { describe, expect, it } from "vitest";
import { hasSkipInstruction } from "./skipInstruction.js";

describe("hasSkipInstruction", () => {
  it.each(["skip ci", "ci skip", "no ci", "skip actions", "actions skip"])(
    "recognizes [%s] anywhere in the message",
    (token) => {
      expect(hasSkipInstruction(`fix build\n\nalso [${token}] please`)).toBe(true);
    },
  );

  it("matches the bracket form case-insensitively", () => {
    expect(hasSkipInstruction("chore [Skip CI]")).toBe(true);
  });

  it("requires the brackets", () => {
    expect(hasSkipInstruction("this commit will skip ci")).toBe(false);
  });

  it("recognizes the skip-checks trailer on its own line", () => {
    expect(hasSkipInstruction("fix build\n\nskip-checks: true")).toBe(true);
    expect(hasSkipInstruction("mentions skip-checks: true mid-line")).toBe(false);
  });

  it("lets an ordinary message through", () => {
    expect(hasSkipInstruction("fix the build")).toBe(false);
  });
});
