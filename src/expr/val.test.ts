import { describe, expect, it } from "vitest";
import { UNKNOWN, type Scope, type Val } from "./val.js";

describe("the value lattice", () => {
  it("keeps UNKNOWN a bare point with no payload", () => {
    expect(UNKNOWN).toEqual({ kind: "unknown" });
  });

  it("admits every point of the lattice", () => {
    const vals: Val[] = [
      { kind: "value", v: "s" },
      { kind: "value", v: 1 },
      { kind: "value", v: true },
      { kind: "json", v: [] },
      { kind: "json", v: {} },
      { kind: "truthy" },
      { kind: "falsy" },
      UNKNOWN,
    ];
    expect(vals).toHaveLength(8);
  });

  it("admits a scope with every context supplied", () => {
    const scope: Scope = {
      inputs: { mode: { kind: "value", v: "fast" } },
      github: { event_name: "pull_request" },
      needs: { detect: { outputs: { x: "y" } } },
      steps: { scan: { outputs: {} } },
    };
    expect(scope.inputs?.mode).toEqual({ kind: "value", v: "fast" });
    expect(scope.needs?.detect.outputs.x).toBe("y");
  });
});
