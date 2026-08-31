import { describe, expect, it } from "vitest";
import type { YamlValue } from "../yamlValue.js";
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

  it("reads into a json point as a document value, not `unknown`", () => {
    const v: Val = { kind: "json", v: { cfg: { os: "linux", tags: [1, null] } } };
    const read: YamlValue | undefined =
      v.kind === "json" && !Array.isArray(v.v) ? v.v["cfg"] : undefined;
    expect(read).toEqual({ os: "linux", tags: [1, null] });
  });

  it("admits a scope with every context supplied", () => {
    const scope: Scope = {
      inputs: { mode: { kind: "value", v: "fast" } },
      github: { event_name: "pull_request" },
      needs: { detect: { outputs: { x: "y" } } },
      steps: { scan: { outputs: {} } },
    };
    expect(scope.inputs?.mode).toEqual({ kind: "value", v: "fast" });
  });
});
