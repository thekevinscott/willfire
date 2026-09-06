import { describe, expect, it } from "vitest";
import { errorStatus } from "./errorStatus.js";

describe("errorStatus", () => {
  it("reads the status off an Error carrying one, as the client's does", () => {
    expect(errorStatus(Object.assign(new Error("GitHub API 404 for /x"), { status: 404 }))).toBe(
      404,
    );
  });

  it("reads the status off any error shaped like one", () => {
    expect(errorStatus({ status: 403 })).toBe(403);
  });

  it("answers null for an error with no status, as a network failure throws", () => {
    expect(errorStatus(new Error("fetch failed"))).toBe(null);
  });

  it("answers null for a status that is not a number", () => {
    expect(errorStatus({ status: "404" })).toBe(null);
  });

  it("answers null for a thrown non-object", () => {
    expect(errorStatus("404")).toBe(null);
  });

  it("answers null for a thrown null, which is an object", () => {
    expect(errorStatus(null)).toBe(null);
  });
});
