import { describe, expect, it } from "vitest";
import { evaluateValue } from "./evaluateValue.js";
import type { Scope } from "./val.js";

describe("fromJSON values", () => {
  const NEEDS: Scope = {
    needs: { detect: { outputs: { langs: '["typescript","rust"]', empty: "[]" } } },
  };

  it("parses an array out of an output", () => {
    expect(evaluateValue("fromJSON(needs.detect.outputs.langs)", NEEDS)).toEqual({
      kind: "json",
      v: ["typescript", "rust"],
    });
    expect(evaluateValue("fromJSON(needs.detect.outputs.empty)", NEEDS)).toEqual({
      kind: "json",
      v: [],
    });
  });

  it("parses an object", () => {
    expect(evaluateValue("fromJSON('{\"a\":1}')")).toEqual({ kind: "json", v: { a: 1 } });
  });

  it("is unknown on a string it cannot parse", () => {
    expect(evaluateValue("fromJSON('not json')")).toEqual({ kind: "unknown" });
  });

  it("is unknown when its argument is not a known string", () => {
    expect(evaluateValue("fromJSON(needs.other.outputs.x)", NEEDS)).toEqual({ kind: "unknown" });
    expect(evaluateValue("fromJSON(3)")).toEqual({ kind: "unknown" });
    expect(evaluateValue("fromJSON('[]', 'x')")).toEqual({ kind: "unknown" });
  });
});

describe("evaluateValue", () => {
  it("refuses the same shapes evaluate refuses", () => {
    expect(evaluateValue("")).toEqual({ kind: "unknown" });
    expect(evaluateValue("${{ }}")).toEqual({ kind: "unknown" });
    expect(evaluateValue("a ${{ b }} c")).toEqual({ kind: "unknown" });
    expect(evaluateValue("'a' 'b'")).toEqual({ kind: "unknown" });
    expect(evaluateValue("@")).toEqual({ kind: "unknown" });
  });

  it("strips the wrapper the way an if: does", () => {
    expect(evaluateValue("${{ 'a' }}")).toEqual({ kind: "value", v: "a" });
  });
});
