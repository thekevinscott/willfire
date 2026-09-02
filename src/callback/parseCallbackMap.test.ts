import { describe, expect, it } from "vitest";
import { parseCallbackMap } from "./parseCallbackMap.js";

const KEY = "o/r/.github/workflows/w.yml:plan";

describe("parseCallbackMap", () => {
  it("parses the documented map shape", () => {
    const doc = {
      [KEY]: [
        { inputs: { language: "typescript" }, outputs: { checks: '["a","b"]' } },
        { inputs: {}, outputs: {} },
      ],
    };
    expect(parseCallbackMap(JSON.stringify(doc))).toEqual({ ok: true, map: doc });
  });

  it("parses an empty map, which answers for no jobs at all", () => {
    expect(parseCallbackMap("{}")).toEqual({ ok: true, map: {} });
  });

  it("refuses stdout that is not JSON", () => {
    expect(parseCallbackMap("not json")).toEqual({ ok: false, reason: "stdout is not JSON" });
  });

  it("refuses a JSON root that is not an object", () => {
    const reason = "stdout is not a JSON object";
    expect(parseCallbackMap("[]")).toEqual({ ok: false, reason });
    expect(parseCallbackMap("null")).toEqual({ ok: false, reason });
    expect(parseCallbackMap('"x"')).toEqual({ ok: false, reason });
  });

  it("refuses a key whose value is not an array", () => {
    expect(parseCallbackMap(JSON.stringify({ [KEY]: {} }))).toEqual({
      ok: false,
      reason: `'${KEY}' is not an array`,
    });
  });

  it("refuses an entry that is not an object", () => {
    expect(parseCallbackMap(JSON.stringify({ [KEY]: [[]] }))).toEqual({
      ok: false,
      reason: `'${KEY}'[0] is not an object`,
    });
    expect(parseCallbackMap(JSON.stringify({ [KEY]: [null] }))).toEqual({
      ok: false,
      reason: `'${KEY}'[0] is not an object`,
    });
  });

  it("refuses an entry carrying anything beyond inputs and outputs", () => {
    const doc = { [KEY]: [{ inputs: {}, outputs: {}, input: {} }] };
    expect(parseCallbackMap(JSON.stringify(doc))).toEqual({
      ok: false,
      reason: `'${KEY}'[0] has an unexpected key 'input'`,
    });
  });

  it("refuses an entry missing inputs or outputs, naming which", () => {
    expect(parseCallbackMap(JSON.stringify({ [KEY]: [{ outputs: {} }] }))).toEqual({
      ok: false,
      reason: `'${KEY}'[0].inputs is not an object`,
    });
    expect(parseCallbackMap(JSON.stringify({ [KEY]: [{ inputs: {} }] }))).toEqual({
      ok: false,
      reason: `'${KEY}'[0].outputs is not an object`,
    });
  });

  it("refuses inputs or outputs that are not objects of strings", () => {
    expect(
      parseCallbackMap(JSON.stringify({ [KEY]: [{ inputs: [], outputs: {} }] })),
    ).toEqual({ ok: false, reason: `'${KEY}'[0].inputs is not an object` });
    expect(
      parseCallbackMap(JSON.stringify({ [KEY]: [{ inputs: { n: 1 }, outputs: {} }] })),
    ).toEqual({ ok: false, reason: `'${KEY}'[0].inputs value 'n' is not a string` });
    expect(
      parseCallbackMap(JSON.stringify({ [KEY]: [{ inputs: {}, outputs: { ok: true } }] })),
    ).toEqual({ ok: false, reason: `'${KEY}'[0].outputs value 'ok' is not a string` });
  });

  it("names the failing entry by index, not just the key", () => {
    const doc = { [KEY]: [{ inputs: {}, outputs: {} }, { inputs: {}, outputs: { n: 2 } }] };
    expect(parseCallbackMap(JSON.stringify(doc))).toEqual({
      ok: false,
      reason: `'${KEY}'[1].outputs value 'n' is not a string`,
    });
  });

  it("keeps a hostile key as plain data", () => {
    const parsed = parseCallbackMap('{"__proto__": []}');
    expect(parsed).toEqual({ ok: true, map: { ["__proto__"]: [] } });
    if (parsed.ok) {
      expect(Object.hasOwn(parsed.map, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(parsed.map)).toBe(Object.prototype);
    }
  });
});
