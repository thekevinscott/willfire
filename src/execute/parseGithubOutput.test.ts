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

  it("reads a << on the right of an = as part of the value", () => {
    expect(parseGithubOutput("a=b<<c\n")).toEqual({ a: "b<<c" });
  });

  it("refuses a heredoc header with anything after the delimiter", () => {
    // A CRLF line ending leaves the CR there, and the runner would take it as
    // part of the delimiter; refusing beats guessing which one it meant.
    expect(parseGithubOutput("a<<EOF\r\nx\nEOF\n")).toBe(null);
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
