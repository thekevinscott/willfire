import { describe, expect, it } from "vitest";
import { failureTail } from "./failureTail.js";

describe("failureTail", () => {
  it("quotes the last line of stderr", () => {
    expect(failureTail({ stdout: "out", stderr: "first\nlast\n" })).toBe("last");
  });

  it("falls back to stdout when stderr is empty", () => {
    expect(failureTail({ stdout: "first\nlast\n", stderr: "  \n" })).toBe("last");
  });

  it("is empty when neither stream has one", () => {
    expect(failureTail({ stdout: "", stderr: "" })).toBe("");
  });
});
