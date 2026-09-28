import { describe, expect, it } from "vitest";
import { truthy } from "./truthy.js";
import type { Val } from "./val.js";

describe("truthy", () => {
  it.each<[Val, boolean | null]>([
    [{ kind: "truthy" }, true],
    [{ kind: "falsy" }, false],
    [{ kind: "unknown" }, null],
    // Probe #383 run 36430453652: an array or object is true, empty or not.
    [{ kind: "json", v: [] }, true],
    [{ kind: "json", v: [1] }, true],
    [{ kind: "json", v: { a: 1 } }, true],

    [{ kind: "value", v: true }, true],
    [{ kind: "value", v: false }, false],
    [{ kind: "value", v: 0 }, false],
    [{ kind: "value", v: 2 }, true],
    [{ kind: "value", v: "" }, false],
    [{ kind: "value", v: "0" }, true],
  ])("reads %j as %j", (val, want) => {
    expect(truthy(val)).toBe(want);
  });
});
