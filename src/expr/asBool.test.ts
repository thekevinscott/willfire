import { describe, expect, it } from "vitest";
import { asBool } from "./asBool.js";

describe("asBool", () => {
  it.each<[boolean | null, unknown]>([
    [true, { kind: "value", v: true }],
    [false, { kind: "value", v: false }],
    [null, { kind: "unknown" }],
  ])("wraps %j as %j", (decided, want) => {
    expect(asBool(decided)).toEqual(want);
  });
});
