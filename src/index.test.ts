import { describe, expect, it } from "vitest";
import type { JobExecutor as ExecuteJobExecutor } from "./execute/index.js";
import * as barrel from "./index.js";
import type { ExecOutcome, JobExecutor } from "./index.js";

describe("root barrel", () => {
  it("exposes exactly the published surface", () => {
    // pr-monitor imports Entry, JobEntry, WorkflowEntry and Prediction from
    // here; the runtime names below are the rest of the contract.
    expect(Object.keys(barrel).sort()).toEqual([
      "evalIf",
      "expandMatrix",
      "expandWorkflowJobs",
      "isJobEntry",
      "isWorkflowEntry",
      "jobName",
      "makeOctokit",
      "matchFilters",
      "parseUses",
      "patternToRegex",
      "predict",
    ]);
    for (const fn of Object.values(barrel)) {
      expect(typeof fn).toBe("function");
    }
  });

  it("re-exports the executor seam types", () => {
    // Type-only, erased at runtime — which is why the key list above cannot
    // show them. Compiling these assignments is the assertion.
    const outcome: ExecOutcome = { ok: false, reason: "r" };
    const executor: JobExecutor = { executeJob: async () => outcome };
    // Re-exports of the execute module's own types, not structural copies.
    const same: ExecuteJobExecutor = executor;
    expect(typeof same.executeJob).toBe("function");
  });
});
