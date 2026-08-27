import { describe, expect, it } from "vitest";
import { renderTemplate } from "./renderTemplate.js";

describe("renderTemplate", () => {
  it("passes text with no templates through unchanged", () => {
    expect(renderTemplate("plain text", {})).toBe("plain text");
  });

  it("renders every ${{ }} against the scope", () => {
    const scope = { github: { repository: "o/r", event_name: "pull_request" } };
    expect(renderTemplate("${{ github.repository }}:${{ github.event_name }}", scope)).toBe(
      "o/r:pull_request",
    );
  });

  it("yields null when any expression cannot be settled", () => {
    // A partial render would be a different program.
    expect(renderTemplate("a ${{ github.repository }} b ${{ env.nope }}", {})).toBe(null);
  });
});
