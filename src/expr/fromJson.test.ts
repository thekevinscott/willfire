import { describe, expect, it } from "vitest";
import { fromJson } from "./fromJson.js";

describe("fromJson", () => {
  it("keeps an array or an object at the json point", () => {
    expect(fromJson({ kind: "value", v: "[1,2]" })).toEqual({ kind: "json", v: [1, 2] });
    expect(fromJson({ kind: "value", v: '{"a":1}' })).toEqual({ kind: "json", v: { a: 1 } });
  });

  it("hands back a scalar as an ordinary value", () => {
    expect(fromJson({ kind: "value", v: "3" })).toEqual({ kind: "value", v: 3 });
    expect(fromJson({ kind: "value", v: "true" })).toEqual({ kind: "value", v: true });
    expect(fromJson({ kind: "value", v: '"s"' })).toEqual({ kind: "value", v: "s" });
  });

  it("reads a parsed null as falsy", () => {
    expect(fromJson({ kind: "value", v: "null" })).toEqual({ kind: "falsy" });
  });

  it("is unknown on a string it cannot parse", () => {
    expect(fromJson({ kind: "value", v: "not json" })).toEqual({ kind: "unknown" });
  });

  it("is unknown when the argument is not a known string", () => {
    expect(fromJson({ kind: "value", v: 3 })).toEqual({ kind: "unknown" });
    expect(fromJson({ kind: "unknown" })).toEqual({ kind: "unknown" });
    expect(fromJson({ kind: "json", v: [] })).toEqual({ kind: "unknown" });
  });
});
