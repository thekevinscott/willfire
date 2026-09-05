import { describe, expect, it } from "vitest";
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
      "makeGithubClient",
      "matchFilters",
      "parseUses",
      "patternToRegex",
      "predict",
    ]);
    // Each name is re-exported from the module that defines it, so the
    // function's own name is what catches a re-export bound to the wrong one.
    for (const [name, fn] of Object.entries(barrel)) {
      expect(typeof fn).toBe("function");
      expect(fn.name).toBe(name);
    }
  });

  it("re-exports the executor seam types", () => {
    // Type-only, erased at runtime — which is why the key list above cannot
    // show them. Compiling these assignments is the assertion.
    const outcome: ExecOutcome = { ok: false, reason: "r" };
    const executor: JobExecutor = { executeJob: async () => outcome };
    expect(typeof executor.executeJob).toBe("function");
  });

  it("re-exports the success variant of the outcome, not just the failure", async () => {
    // Both arms travel: pr-monitor reads `outputs` off a successful one.
    const outcome: ExecOutcome = { ok: true, outputs: { languages: "[]" } };
    const executor: JobExecutor = { executeJob: async () => outcome };
    expect(await executor.executeJob("detect", {}, {}, {})).toEqual({
      ok: true,
      outputs: { languages: "[]" },
    });
  });
});
