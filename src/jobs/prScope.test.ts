import { describe, expect, it } from "vitest";
import type { Scope } from "../expr/val.js";
import { prScope } from "./prScope.js";

describe("prScope", () => {
  it("seeds the fixed pull-request event name", () => {
    expect(prScope({})).toEqual({ github: { event_name: "pull_request" } });
  });

  it("lets the caller's github facts win", () => {
    expect(prScope({ github: { event_name: "push", repository: "o/r" } })).toEqual({
      github: { event_name: "push", repository: "o/r" },
    });
  });

  it("keeps every other key the caller stated", () => {
    // In and out are the expr module's own Scope, not structural copies.
    const caller: Scope = { inputs: { x: { kind: "value", v: "v" } } };
    expect(prScope(caller)).toEqual({
      inputs: { x: { kind: "value", v: "v" } },
      github: { event_name: "pull_request" },
    });
  });
});
