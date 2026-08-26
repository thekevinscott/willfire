import { describe, expect, it } from "vitest";
import { neededJobIds } from "./neededJobIds.js";

describe("neededJobIds", () => {
  it("finds a read in a job-level if:", () => {
    const jobs = { a: { if: "needs.det.outputs.y == 'z'" } };
    expect(neededJobIds(jobs)).toEqual(new Set(["det"]));
  });

  it("finds a read anywhere in the serialized job, matrix included", () => {
    const jobs = {
      cover: { strategy: { matrix: { lang: "${{ fromJSON(needs.detect.outputs.langs) }}" } } },
      call: { with: { m: "${{ needs.plan.outputs.matrix }}" } },
    };
    expect(neededJobIds(jobs)).toEqual(new Set(["detect", "plan"]));
  });

  it("does not count a read of anything but outputs", () => {
    expect(neededJobIds({ a: { if: "needs.x.result == 'success'" } })).toEqual(new Set());
  });

  it("tolerates an empty job body", () => {
    expect(neededJobIds({ a: null as never })).toEqual(new Set());
  });
});
