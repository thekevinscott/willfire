import { describe, expect, it, vi } from "vitest";
import { emptyMatrixAxis } from "./emptyMatrixAxis.js";

// The isolation gate wants collaborators mocked; the per-job read is the thing
// this walk exists to apply, so the mock passes the real module through.
vi.mock(
  "./emptyAxisOf.js",
  async () => await vi.importActual<typeof import("./emptyAxisOf.js")>("./emptyAxisOf.js"),
);

describe("emptyMatrixAxis", () => {
  it("names the empty axis found in any job, not only the first", () => {
    const wf = {
      jobs: { sibling: { steps: [] }, m: { strategy: { matrix: { a: ["x"], b: [] } } } },
    };
    expect(emptyMatrixAxis(wf)).toBe("b");
  });

  it("answers null when no job carries one", () => {
    expect(emptyMatrixAxis({})).toBeNull();
    expect(emptyMatrixAxis({ jobs: {} })).toBeNull();
    expect(emptyMatrixAxis({ jobs: { a: null } })).toBeNull();
    expect(emptyMatrixAxis({ jobs: { a: { strategy: { matrix: { os: ["x"] } } } } })).toBeNull();
  });
});
