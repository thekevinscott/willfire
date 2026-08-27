import { describe, expect, it } from "vitest";
import { truthy } from "./truthy.js";
import type { Val } from "./val.js";

describe("truthy", () => {
  it.each<[Val, boolean | null]>([
    [{ kind: "truthy" }, true],
    [{ kind: "falsy" }, false],
    [{ kind: "unknown" }, null],
    [{ kind: "json", v: [] }, null],
    [{ kind: "value", v: true }, true],
    [{ kind: "value", v: false }, false],
    [{ kind: "value", v: 0 }, false],
    [{ kind: "value", v: 2 }, true],
    [{ kind: "value", v: "" }, false],
    [{ kind: "value", v: "0" }, true],
    [{ kind: "value", v: "false" }, true],
  ])("reads %j as %j", (val, want) => {
    expect(truthy(val)).toBe(want);
  });
});
