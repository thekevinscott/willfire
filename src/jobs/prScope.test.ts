import { describe, expect, it } from "vitest";
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
    expect(prScope({ inputs: { x: { kind: "value", v: "v" } } })).toEqual({
      inputs: { x: { kind: "value", v: "v" } },
      github: { event_name: "pull_request" },
    });
  });
});
