import { describe, expect, it } from "vitest";
import { tailLine } from "./tailLine.js";

describe("tailLine", () => {
  it("takes the last line", () => {
    expect(tailLine("first\nsecond\nthird")).toBe("third");
  });

  it("ignores trailing blank lines", () => {
    expect(tailLine("only\n\n  \n")).toBe("only");
  });

  it("takes the whole of a single-line stream", () => {
    expect(tailLine("  just this  ")).toBe("just this");
  });

  it("yields the empty string for a stream with nothing in it", () => {
    expect(tailLine("   \n\n")).toBe("");
  });

  it("keeps only the tail of a line longer than the cap", () => {
    expect(tailLine(`head\n${"y".repeat(5000)}END`)).toBe(`${"y".repeat(4093)}END`);
  });
});
