import { describe, expect, it } from "vitest";
import { githubApiError } from "./githubApiError.js";

describe("githubApiError", () => {
  it("carries the status as a number, not only in the message", () => {
    const err = githubApiError(429, "/repos/o/r/contents/w.yml?ref=abc");
    expect(err.status).toBe(429);
    expect(err.message).toBe("GitHub API 429 for /repos/o/r/contents/w.yml?ref=abc");
  });

  it("carries the response headers where octokit's errors carry theirs", () => {
    const err = githubApiError(403, "/x", { "x-ratelimit-remaining": "0" });
    expect(err.response.headers).toEqual({ "x-ratelimit-remaining": "0" });
  });

  it("defaults to no headers, for a caller that has none to hand over", () => {
    expect(githubApiError(404, "/x").response.headers).toEqual({});
  });

  it("is a real Error, so rethrowing it keeps a stack", () => {
    const err = githubApiError(404, "/x");
    expect(err).toBeInstanceOf(Error);
    expect(typeof err.stack).toBe("string");
  });
});
