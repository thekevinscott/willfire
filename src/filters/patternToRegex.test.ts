import { describe, expect, it } from "vitest";
import { patternToRegex } from "./patternToRegex.js";

describe("patternToRegex", () => {
  it("anchors the whole value", () => {
    const re = patternToRegex("main");
    expect(re.test("main")).toBe(true);
    expect(re.test("mainline")).toBe(false);
    expect(re.test("releases/main")).toBe(false);
  });

  it("treats a single * as any run of non-separator characters", () => {
    const re = patternToRegex("src/*.ts");
    expect(re.test("src/app.ts")).toBe(true);
    expect(re.test("src/nested/app.ts")).toBe(false);
  });

  it("treats ** as any run of characters, separators included", () => {
    const re = patternToRegex("src/**");
    expect(re.test("src/nested/app.ts")).toBe(true);
  });

  it("treats a leading **/ as zero or more directories", () => {
    // GitHub dispatched `**/*.txt` for a top-level file: probe run 36429114415.
    const re = patternToRegex("**/*.md");
    expect(re.test("README.md")).toBe(true);
    expect(re.test("docs/a.md")).toBe(true);
    expect(re.test("docs/nested/a.md")).toBe(true);
    expect(re.test("README.txt")).toBe(false);
  });

  it("treats a **/ away from the start as zero or more directories too", () => {
    // Same for `gdocs/**/*.md` against `gdocs/m.md`: probe run 36429340492.
    const re = patternToRegex("docs/**/*.md");
    expect(re.test("docs/a.md")).toBe(true);
    expect(re.test("docs/nested/a.md")).toBe(true);
    expect(re.test("a.md")).toBe(false);
  });

  it("passes ? through as zero-or-one of the preceding character", () => {
    const re = patternToRegex("releases?");
    expect(re.test("release")).toBe(true);
    expect(re.test("releases")).toBe(true);
    expect(re.test("releasess")).toBe(false);
  });

  it("passes + through as one-or-more of the preceding character", () => {
    const re = patternToRegex("v1+");
    expect(re.test("v1")).toBe(true);
    expect(re.test("v111")).toBe(true);
    expect(re.test("v")).toBe(false);
  });

  it("passes a character range through untouched", () => {
    const re = patternToRegex("v[0-9]");
    expect(re.test("v7")).toBe(true);
    expect(re.test("vx")).toBe(false);
  });

  it("escapes regex metacharacters that are literal in the glob grammar", () => {
    const re = patternToRegex("v1.0");
    expect(re.test("v1.0")).toBe(true);
    expect(re.test("v1x0")).toBe(false);
  });

  it("takes a backslash as escaping the next character", () => {
    const re = patternToRegex(String.raw`a\*b`);
    expect(re.test("a*b")).toBe(true);
    expect(re.test("axb")).toBe(false);
  });
});
