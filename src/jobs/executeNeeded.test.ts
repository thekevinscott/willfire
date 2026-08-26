import { describe, expect, it } from "vitest";
import type { JobExecutor } from "../execute/types.js";
import { executeNeeded } from "./executeNeeded.js";

/** An executor that records what it is asked to run and answers `outputs`. */
const recording = (outputs: Record<string, string>) => {
  const executed: string[] = [];
  const executor: JobExecutor = {
    executeJob: async (jobId) => {
      executed.push(jobId);
      return { ok: true, outputs };
    },
  };
  return { executed, executor };
};

describe("executeNeeded", () => {
  it("executes exactly the jobs a sibling reads outputs from", async () => {
    const { executed, executor } = recording({ langs: '["ts"]' });
    const jobs = {
      detect: { steps: [] },
      helper: { steps: [] },
      cover: { needs: "detect", if: "needs.detect.outputs.langs != ''" },
    };
    const { scoped, execFailures } = await executeNeeded(jobs, { jobs }, {}, executor);
    expect(executed).toEqual(["detect"]);
    expect(scoped.needs).toEqual({ detect: { outputs: { langs: '["ts"]' } } });
    expect(execFailures).toEqual({});
  });

  it("never executes a reusable-call job, even when a sibling reads its outputs", async () => {
    const { executed, executor } = recording({});
    const jobs = {
      plan: { uses: "./.github/workflows/sub.yml" },
      build: { if: "needs.plan.outputs.x == 'y'" },
    };
    const { scoped } = await executeNeeded(jobs, { jobs }, {}, executor);
    expect(executed).toEqual([]);
    expect(scoped.needs).toBeUndefined();
  });

  it("does not execute a needed job whose if: fails", async () => {
    const { executed, executor } = recording({});
    const jobs = {
      detect: { if: false, steps: [] },
      cover: { if: "needs.detect.outputs.x == 'y'" },
    };
    await executeNeeded(jobs, { jobs }, {}, executor);
    expect(executed).toEqual([]);
  });

  it("records a failure without touching the scope", async () => {
    const executor: JobExecutor = {
      executeJob: async () => ({ ok: false, reason: "docker not found" }),
    };
    const jobs = {
      detect: { steps: [] },
      cover: { if: "needs.detect.outputs.x == 'y'" },
    };
    const { scoped, execFailures } = await executeNeeded(jobs, { jobs }, {}, executor);
    expect(execFailures).toEqual({ detect: "docker not found" });
    expect(scoped.needs).toBeUndefined();
  });

  it("tolerates an empty job body", async () => {
    const { executed, executor } = recording({});
    const jobs = { detect: null as never, cover: { if: "needs.detect.outputs.x == 'y'" } };
    const { execFailures } = await executeNeeded(jobs, { jobs }, {}, executor);
    // An empty body has no `uses`, passes evalIf, and gets executed.
    expect(executed).toEqual(["detect"]);
    expect(execFailures).toEqual({});
  });
});
