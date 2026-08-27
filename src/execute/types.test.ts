import { describe, expect, it } from "vitest";
import type { ExecOutcome, ExecutionGrant, RunSpec } from "./types.js";

describe("execute types", () => {
  it("shape a grant, a run spec, and an outcome", () => {
    const grant: ExecutionGrant = { repo: "o/r", jobs: ["detect"] };
    const spec: RunSpec = { script: "true", shell: "bash", cwd: "/", env: {} };
    const outcome: ExecOutcome = { ok: false, reason: "nope" };
    expect([grant.repo, spec.shell, outcome.ok]).toEqual(["o/r", "bash", false]);
  });
});
