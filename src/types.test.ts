// `types.ts` is pure types, so what this suite pins is the compile-time
// surface: the assertions are assignments and the checker is the harness.

import { describe, expect, it } from "vitest";
import type { JobExecutor } from "./execute/types.js";
import type { PredictOptions } from "./types.js";

describe("PredictOptions", () => {
  it("takes a JobExecutor seam, null to disable execution, or nothing", () => {
    // The seam is the execute module's own JobExecutor, not a structural copy.
    const executor: JobExecutor = { executeJob: async () => ({ ok: false, reason: "r" }) };
    const seam: PredictOptions = { executor };
    const off: PredictOptions = { executor: null };
    const dflt: PredictOptions = {};
    // @ts-expect-error the grant-era `execute:` option is gone
    const grants: PredictOptions = { execute: [] };
    expect([seam, off, dflt, grants].map((o) => typeof o)).toEqual(Array(4).fill("object"));
  });
});
