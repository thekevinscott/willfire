import { describe, expect, it } from "vitest";
import type { ExecOutcome, Mount, ProvideTree, RunResult, RunSpec } from "./types.js";

describe("execute types", () => {
  it("pins the shapes the executor is built from", () => {
    const mount: Mount = { path: "/w", writable: true };
    const spec: RunSpec = { script: "true", shell: "bash", cwd: "/w", env: {}, mounts: [mount] };
    const result: RunResult = { code: 0, stderr: "" };
    const ok: ExecOutcome = { ok: true, outputs: {} };
    const stop: ExecOutcome = { ok: false, reason: "why" };
    const provide: ProvideTree = async (_source, _opts) => null;
    // @ts-expect-error a RunSpec names its shell — there is no default
    const incomplete: RunSpec = { script: "true", cwd: "/w", env: {} };
    expect([spec, result, ok, stop, incomplete].map((v) => typeof v)).toEqual(
      Array(5).fill("object"),
    );
    expect(typeof provide).toBe("function");
  });
});
