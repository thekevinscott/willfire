import { describe, expect, it } from "vitest";
import { matchFilters } from "./matchFilters.js";

describe("matchFilters", () => {
  it("is false when nothing matches", () => {
    expect(matchFilters("main", ["releases/*"])).toBe(false);
  });

  it("is true on a plain match", () => {
    expect(matchFilters("releases/v1", ["releases/*"])).toBe(true);
  });

  it("lets the last matching pattern win", () => {
    expect(matchFilters("main", ["**", "!main"])).toBe(false);
    expect(matchFilters("main", ["!main", "**"])).toBe(true);
  });

  it("ignores a negation that does not match", () => {
    expect(matchFilters("main", ["**", "!dev"])).toBe(true);
  });
});
