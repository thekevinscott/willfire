import { describe, expect, it } from "vitest";
import { indexVal } from "./indexVal.js";
import type { Val } from "./val.js";

const ARR: Val = { kind: "json", v: [5, [7], null] };
const OBJ: Val = { kind: "json", v: { k: "v", nested: {} } };

describe("indexVal", () => {
  it("indexes an array by number and an object by string", () => {
    expect(indexVal(ARR, { kind: "value", v: 0 })).toEqual({ kind: "value", v: 5 });
    expect(indexVal(OBJ, { kind: "value", v: "k" })).toEqual({ kind: "value", v: "v" });
  });

  it("keeps a structured element structured", () => {
    expect(indexVal(ARR, { kind: "value", v: 1 })).toEqual({ kind: "json", v: [7] });
    expect(indexVal(OBJ, { kind: "value", v: "nested" })).toEqual({ kind: "json", v: {} });
  });

  it("reads a missing or null element as the empty string", () => {
    expect(indexVal(ARR, { kind: "value", v: 9 })).toEqual({ kind: "value", v: "" });
    expect(indexVal(ARR, { kind: "value", v: 2 })).toEqual({ kind: "value", v: "" });
    expect(indexVal(OBJ, { kind: "value", v: "missing" })).toEqual({ kind: "value", v: "" });
  });

  it("refuses a base that is not json", () => {
    expect(indexVal({ kind: "value", v: "abc" }, { kind: "value", v: 0 })).toEqual({
      kind: "unknown",
    });
  });

  it("refuses an index that is unknown or of the wrong type", () => {
    expect(indexVal(ARR, { kind: "unknown" })).toEqual({ kind: "unknown" });
    expect(indexVal(ARR, { kind: "value", v: "k" })).toEqual({ kind: "unknown" });
    expect(indexVal(OBJ, { kind: "value", v: 0 })).toEqual({ kind: "unknown" });
  });
});
