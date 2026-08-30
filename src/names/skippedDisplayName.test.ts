import { describe, expect, it } from "vitest";
import { skippedDisplayName } from "./skippedDisplayName.js";

describe("skippedDisplayName", () => {
  it("keeps the raw name uninterpolated", () => {
    expect(skippedDisplayName("a", { name: "sk ${{ github.event_name }}" })).toEqual({
      name: "sk ${{ github.event_name }}",
      resolved: true,
    });
  });

  it("falls back to the job id when there is no name", () => {
    expect(skippedDisplayName("a", {})).toEqual({ name: "a", resolved: true });
    expect(skippedDisplayName("a", { name: null })).toEqual({ name: "a", resolved: true });
  });

  it("renders a name YAML read as a number", () => {
    // `name: 2024` is a number, not a string, and the check name is its text.
    expect(skippedDisplayName("a", { name: 2024 })).toEqual({ name: "2024", resolved: true });
  });

  it("caps the name at GitHub's 100-character display limit", () => {
    expect(skippedDisplayName("a", { name: "y".repeat(120) })).toEqual({
      name: `${"y".repeat(97)}...`,
      resolved: true,
    });
  });
});
