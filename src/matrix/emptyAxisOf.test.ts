import { describe, expect, it } from "vitest";
import { emptyAxisOf } from "./emptyAxisOf.js";

describe("emptyAxisOf", () => {
  it("names the empty axis", () => {
    expect(emptyAxisOf({ strategy: { matrix: { os: [] } } })).toBe("os");
    expect(emptyAxisOf({ strategy: { matrix: { a: ["x"], b: [] } } })).toBe("b");
  });

  it("ignores empty include and exclude lists, which are not axes", () => {
    expect(emptyAxisOf({ strategy: { matrix: { os: ["x"], include: [], exclude: [] } } })).toBeNull();
  });

  it("ignores an axis written as an expression", () => {
    // `fromJSON(...)` yielding `[]` cancels only its own job at run time —
    // probe PR #372 run 36430084611 ran both siblings and concluded failure.
    const job = { strategy: { matrix: { os: "${{ fromJSON(needs.d.outputs.list) }}" } } };
    expect(emptyAxisOf(job)).toBeNull();
  });

  it("answers null for the shapes that carry no axis list", () => {
    expect(emptyAxisOf({})).toBeNull();
    expect(emptyAxisOf({ strategy: null })).toBeNull();
    expect(emptyAxisOf({ strategy: "${{ x }}" })).toBeNull();
    expect(emptyAxisOf({ strategy: { matrix: null } })).toBeNull();
    expect(emptyAxisOf({ strategy: { matrix: "${{ x }}" } })).toBeNull();
    expect(emptyAxisOf({ strategy: { matrix: { os: 5 } } })).toBeNull();
  });
});
