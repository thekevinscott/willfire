// `types.ts` is pure types, so what this suite pins is the compile-time
// surface: the assertions are assignments and the checker is the harness.

import { describe, expect, it } from "vitest";
import type { PredictOptions } from "./types.js";

describe("PredictOptions", () => {
  it("takes a JobExecutor seam, null to disable execution, or nothing", () => {
    const seam: PredictOptions = {
      executor: { executeJob: async () => ({ ok: false, reason: "r" }) },
    };
    const off: PredictOptions = { executor: null };
    const dflt: PredictOptions = {};
    // @ts-expect-error the grant-era `execute:` option is gone
    const grants: PredictOptions = { execute: [] };
    expect([seam, off, dflt, grants].map((o) => typeof o)).toEqual(Array(4).fill("object"));
  });
});
