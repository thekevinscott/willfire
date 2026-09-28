import { describe, expect, it } from "vitest";
import { containsCall } from "./containsCall.js";
import type { YamlMap, YamlValue } from "../yamlValue.js";
import type { Val } from "./val.js";

const S = (v: string | number | boolean): Val => ({ kind: "value", v });
const J = (v: YamlValue[] | YamlMap): Val => ({ kind: "json", v });

describe("containsCall", () => {
  it("reads a string haystack as a substring test", () => {
    expect(containsCall(S("abc"), S("b"))).toEqual(S(true));
    expect(containsCall(S("abc"), S("z"))).toEqual(S(false));
  });

  // Probe #383, runs 36430453627 and 36431899958.
  it("reads an array haystack by element equality, not by substring", () => {
    expect(containsCall(J(["a", "b"]), S("a"))).toEqual(S(true));
    expect(containsCall(J(["a", "b"]), S("c"))).toEqual(S(false));
    expect(containsCall(J(["abc"]), S("ab"))).toEqual(S(false));
    expect(containsCall(J([1, 2]), S(1))).toEqual(S(true));
    expect(containsCall(J([]), S("a"))).toEqual(S(false));
  });

  it("compares an element under the same loose equality == uses", () => {
    // Run 36431899958 ran `contains(fromJSON('[1,2]'), '1')`.
    expect(containsCall(J([1, 2]), S("1"))).toEqual(S(true));
    expect(containsCall(J([0]), S(""))).toEqual(S(true));
    expect(containsCall(J([1]), S("abc"))).toEqual(S(false));
  });

  it("refuses an element it cannot compare, unless a match came first", () => {
    expect(containsCall(J([["a"]]), S("a"))).toEqual({ kind: "unknown" });
    expect(containsCall(J([null]), S("a"))).toEqual({ kind: "unknown" });
    expect(containsCall(J(["a", null]), S("a"))).toEqual(S(true));
  });

  it("refuses an object haystack", () => {
    expect(containsCall(J({ a: 1 }), S("a"))).toEqual({ kind: "unknown" });
  });

  it("refuses a haystack or needle that is not a known value", () => {
    expect(containsCall({ kind: "unknown" }, S("b"))).toEqual({ kind: "unknown" });
    expect(containsCall(J(["a"]), { kind: "truthy" })).toEqual({ kind: "unknown" });
    expect(containsCall(S("abc"), { kind: "unknown" })).toEqual({ kind: "unknown" });
  });

  it("refuses a non-string string comparison", () => {
    expect(containsCall(S(1), S(2))).toEqual({ kind: "unknown" });
    expect(containsCall(S("abc"), S(1))).toEqual({ kind: "unknown" });
  });
});
