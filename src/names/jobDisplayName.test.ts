import { describe, expect, it } from "vitest";
import { jobDisplayName } from "./jobDisplayName.js";

describe("jobDisplayName", () => {
  it("suffixes the job id with the matrix parenthetical when there is no name:", () => {
    expect(jobDisplayName("a", {}, { values: { os: "linux" }, displayKeys: ["os"] })).toEqual({
      name: "a (linux)",
      resolved: true,
    });
  });

  it("uses the bare job id outside a matrix", () => {
    expect(jobDisplayName("a", {}, null)).toEqual({ name: "a", resolved: true });
  });

  it("falls back to the job id when name: is present but null", () => {
    expect(jobDisplayName("a", { name: null }, null)).toEqual({ name: "a", resolved: true });
  });

  it("suppresses the parenthetical when the name holds an expression", () => {
    const d = jobDisplayName(
      "a",
      { name: "build ${{ matrix.os }}" },
      { values: { os: "linux" }, displayKeys: ["os"] },
    );
    expect(d).toEqual({ name: "build linux", resolved: true });
  });

  it("appends the parenthetical to a literal name", () => {
    const d = jobDisplayName("a", { name: "custom" }, { values: { os: "linux" }, displayKeys: ["os"] });
    expect(d).toEqual({ name: "custom (linux)", resolved: true });
  });

  it("marks a name it cannot render as unresolved", () => {
    const d = jobDisplayName("a", { name: "x ${{ inputs.f }}" }, null);
    expect(d).toEqual({ name: "x ${{ inputs.f }}", resolved: false });
  });

  it("caps the rendered name at GitHub's 100-character display limit", () => {
    const d = jobDisplayName("a", { name: "y".repeat(120) }, null);
    expect(d).toEqual({ name: `${"y".repeat(97)}...`, resolved: true });
  });
});
