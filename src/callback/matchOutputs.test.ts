import { describe, expect, it } from "vitest";
import { matchOutputs } from "./matchOutputs.js";
import type { CallbackMap } from "./parseCallbackMap.js";

const KEY = "o/r/.github/workflows/w.yml:plan";

describe("matchOutputs", () => {
  it("answers with the one entry whose inputs are a subset of the invocation's", () => {
    const map: CallbackMap = {
      [KEY]: [
        { inputs: { language: "typescript" }, outputs: { checks: '["ts"]' } },
        { inputs: { language: "rust" }, outputs: { checks: '["rs"]' } },
      ],
    };
    expect(matchOutputs(map, KEY, { language: "typescript", extra: "x" })).toEqual({
      kind: "hit",
      outputs: { checks: '["ts"]' },
    });
  });

  it("lets an entry with empty inputs answer any invocation", () => {
    const map: CallbackMap = { [KEY]: [{ inputs: {}, outputs: { checks: "[]" } }] };
    expect(matchOutputs(map, KEY, {})).toEqual({ kind: "hit", outputs: { checks: "[]" } });
    expect(matchOutputs(map, KEY, { any: "thing" })).toEqual({
      kind: "hit",
      outputs: { checks: "[]" },
    });
  });

  it("does not match an entry wanting an input the invocation lacks or differs on", () => {
    const map: CallbackMap = {
      [KEY]: [{ inputs: { language: "rust" }, outputs: { checks: '["rs"]' } }],
    };
    expect(matchOutputs(map, KEY, { language: "typescript" })).toEqual({
      kind: "no-match",
      reason: `no callback entry matches '${KEY}' with inputs {"language":"typescript"}`,
    });
    expect(matchOutputs(map, KEY, {})).toEqual({
      kind: "no-match",
      reason: `no callback entry matches '${KEY}' with inputs {}`,
    });
  });

  it("reports two qualifying entries as ambiguous, never picks one", () => {
    const map: CallbackMap = {
      [KEY]: [
        { inputs: {}, outputs: { checks: "[]" } },
        { inputs: { language: "typescript" }, outputs: { checks: '["ts"]' } },
      ],
    };
    expect(matchOutputs(map, KEY, { language: "typescript" })).toEqual({
      kind: "ambiguous",
      reason: `2 callback entries match '${KEY}' with inputs {"language":"typescript"}`,
    });
  });

  it("treats a key the map never claims as absent", () => {
    expect(matchOutputs({}, KEY, {})).toEqual({ kind: "absent" });
  });

  it("treats a key with an empty entry list as claimed but unanswered", () => {
    expect(matchOutputs({ [KEY]: [] }, KEY, {})).toEqual({
      kind: "no-match",
      reason: `no callback entry matches '${KEY}' with inputs {}`,
    });
  });

  it("reads only the map's own keys", () => {
    expect(matchOutputs({}, "constructor", {})).toEqual({ kind: "absent" });
  });
});
