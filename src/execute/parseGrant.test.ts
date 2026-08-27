import { describe, expect, it } from "vitest";
import { parseGrant } from "./parseGrant.js";

describe("parseGrant", () => {
  it("parses owner/repo:job1,job2, trimming around the commas", () => {
    expect(parseGrant("o/r:detect, scan")).toEqual({ repo: "o/r", jobs: ["detect", "scan"] });
  });

  it("rejects everything that is not exactly owner/repo:jobs", () => {
    expect(parseGrant("o/r")).toBe(null);
    expect(parseGrant(":detect")).toBe(null);
    expect(parseGrant("or:detect")).toBe(null);
    expect(parseGrant("o/r/x:detect")).toBe(null);
    expect(parseGrant("o/:detect")).toBe(null);
    expect(parseGrant("o/r:")).toBe(null);
    expect(parseGrant("o/r: , ")).toBe(null);
  });
});
