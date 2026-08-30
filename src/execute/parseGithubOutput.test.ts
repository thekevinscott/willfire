import { describe, expect, it } from "vitest";
import { parseGithubOutput } from "./parseGithubOutput.js";

describe("parseGithubOutput", () => {
  it("reads name=value lines, last write winning", () => {
    expect(parseGithubOutput("a=1\nb=\na=2\n")).toEqual({ a: "2", b: "" });
  });

  it("reads a heredoc as one multi-line value", () => {
    expect(parseGithubOutput("key<<EOF\nline1\nline2\nEOF\na=1\n")).toEqual({
      key: "line1\nline2",
      a: "1",
    });
  });

  it("treats << inside a value as text, not a heredoc opener", () => {
    // The heredoc form is anchored: only a whole line of `name<<DELIM` opens one.
    expect(parseGithubOutput("a=b<<EOF\n")).toEqual({ a: "b<<EOF" });
  });

  it("refuses a CRLF heredoc opener instead of reading a value out of it", () => {
    // The opener is anchored at both ends and `.` stops at a carriage return,
    // so a CRLF-written file has no heredoc line here and no `=` either.
    expect(parseGithubOutput("key<<EOF\r\nline1\nEOF\n")).toBe(null);
  });

  it("skips blank lines between assignments", () => {
    expect(parseGithubOutput("a=1\n\nb=2\n")).toEqual({ a: "1", b: "2" });
  });

  it("refuses an unterminated heredoc", () => {
    // The runner fails the step on one; tolerating it here would invent
    // outputs a real run never had.
    expect(parseGithubOutput("k<<EOF\nline1\n")).toBe(null);
  });

  it("refuses a line that assigns nothing", () => {
    expect(parseGithubOutput("garbage\n")).toBe(null);
    expect(parseGithubOutput("=value\n")).toBe(null);
  });
});
