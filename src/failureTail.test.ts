import { describe, expect, it } from "vitest";
import { failureTail } from "./failureTail.js";

describe("failureTail", () => {
  it("quotes stderr", () => {
    expect(failureTail({ stdout: "out", stderr: "first\nlast\n" })).toBe("first\nlast");
  });

  it("falls back to stdout when stderr is empty", () => {
    expect(failureTail({ stdout: "first\nlast\n", stderr: "  \n" })).toBe("first\nlast");
  });

  it("is empty when neither stream has anything to quote", () => {
    expect(failureTail({ stdout: "", stderr: "" })).toBe("");
  });
});
