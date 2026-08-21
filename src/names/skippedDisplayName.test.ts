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
});
