import { describe, expect, it } from "vitest";
import { deriveStatus } from "./deriveStatus.js";

describe("deriveStatus", () => {
  it("runs a job with no condition and no needs", () => {
    expect(deriveStatus({}, {}, {})).toEqual({ status: "run", reason: "", needs: [] });
  });

  it("records the job's own if: as the reason", () => {
    expect(deriveStatus({ if: false }, {}, {})).toEqual({
      status: "skipped",
      reason: "if: false",
      needs: [],
    });
  });

  it("skips a job that needs a skipped job", () => {
    expect(deriveStatus({ needs: ["a"] }, {}, { a: "skipped" })).toEqual({
      status: "skipped",
      reason: "needs 'a' which is skipped",
      needs: ["a"],
    });
  });

  it("normalizes a scalar needs to a list", () => {
    expect(deriveStatus({ needs: "a" }, {}, { a: "skipped" })).toMatchObject({
      status: "skipped",
      needs: ["a"],
    });
  });

  it("makes a would-run job unknown when an upstream status is unknown", () => {
    expect(deriveStatus({ needs: ["a"] }, {}, { a: "unknown" })).toEqual({
      status: "unknown",
      reason: "needs 'a' whose status is unknown",
      needs: ["a"],
    });
  });

  it("leaves an already-unknown job unknown rather than restating why", () => {
    const job = { if: "github.ref == 'x'", needs: ["a"] };
    expect(deriveStatus(job, {}, { a: "unknown" })).toMatchObject({
      status: "unknown",
      reason: "if: \"github.ref == 'x'\"",
    });
  });

  it("does not walk the chain for a job its own if: already skipped", () => {
    expect(deriveStatus({ if: false, needs: ["a"] }, {}, { a: "unknown" })).toMatchObject({
      status: "skipped",
      reason: "if: false",
    });
  });

  it("cuts the chain under always()", () => {
    expect(deriveStatus({ if: "always()", needs: ["a"] }, {}, { a: "skipped" })).toMatchObject({
      status: "run",
    });
  });
});
